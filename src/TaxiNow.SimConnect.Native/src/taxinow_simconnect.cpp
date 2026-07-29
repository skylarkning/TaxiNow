#include "taxinow_simconnect.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>

#if defined(_WIN32)
#include <Windows.h>
#endif

#if defined(TAXINOW_WITH_SIMCONNECT)
#include <SimConnect.h>
#endif

namespace {
using namespace std::chrono_literals;
using steady_clock = std::chrono::steady_clock;

struct bridge_state {
  std::atomic<bool> stop_requested{false};
  std::atomic<bool> running{false};
  std::thread owner_thread;
  std::mutex snapshot_mutex;
  taxinow_telemetry_snapshot snapshot{
      sizeof(taxinow_telemetry_snapshot),
      TAXINOW_SIMCONNECT_ABI_VERSION,
      0,
      0,
      0,
      0.0,
      0.0,
      0.0,
      0.0,
      0,
      0};
  std::mutex error_mutex;
  std::string last_error;
  steady_clock::time_point started_at{steady_clock::now()};

#if defined(TAXINOW_WITH_SIMCONNECT)
  HANDLE simconnect{nullptr};
#endif
};

void set_error(bridge_state& state, std::string message) {
  std::scoped_lock lock(state.error_mutex);
  state.last_error = std::move(message);
}

int64_t monotonic_milliseconds(const bridge_state& state) {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             steady_clock::now() - state.started_at)
      .count();
}

#if defined(TAXINOW_WITH_SIMCONNECT)
enum class data_definition : DWORD {
  user_aircraft = 1,
};

enum class data_request : DWORD {
  user_aircraft = 1,
};

#pragma pack(push, 8)
struct user_aircraft_data {
  double latitude;
  double longitude;
  double true_heading_degrees;
  int32_t on_ground;
  double ground_speed_knots;
};
#pragma pack(pop)

static_assert(offsetof(user_aircraft_data, latitude) == 0);
static_assert(offsetof(user_aircraft_data, longitude) == 8);
static_assert(offsetof(user_aircraft_data, true_heading_degrees) == 16);
static_assert(offsetof(user_aircraft_data, on_ground) == 24);
static_assert(offsetof(user_aircraft_data, ground_speed_knots) == 32);
static_assert(sizeof(user_aircraft_data) == 40);

void CALLBACK dispatch(SIMCONNECT_RECV* message, DWORD size, void* context) {
  auto& state = *static_cast<bridge_state*>(context);
  if (message == nullptr || size < sizeof(SIMCONNECT_RECV)) {
    return;
  }

  switch (message->dwID) {
    case SIMCONNECT_RECV_ID_OPEN: {
      const auto* open = reinterpret_cast<const SIMCONNECT_RECV_OPEN*>(message);
      const std::string name(open->szApplicationName);
      std::scoped_lock lock(state.snapshot_mutex);
      state.snapshot.connected = 1;
      state.snapshot.simulator_edition =
          name.find("2024") != std::string::npos ? 2024 : 2020;
      break;
    }
    case SIMCONNECT_RECV_ID_SIMOBJECT_DATA: {
      const auto* object_data =
          reinterpret_cast<const SIMCONNECT_RECV_SIMOBJECT_DATA*>(message);
      if (object_data->dwRequestID !=
          static_cast<DWORD>(data_request::user_aircraft)) {
        break;
      }
      const auto* data =
          reinterpret_cast<const user_aircraft_data*>(&object_data->dwData);
      if (!std::isfinite(data->latitude) ||
          !std::isfinite(data->longitude) ||
          !std::isfinite(data->true_heading_degrees) ||
          !std::isfinite(data->ground_speed_knots)) {
        set_error(state, "SimConnect returned a non-finite telemetry value.");
        break;
      }
      std::scoped_lock lock(state.snapshot_mutex);
      ++state.snapshot.sequence;
      state.snapshot.connected = 1;
      state.snapshot.on_ground = data->on_ground != 0 ? 1 : 0;
      state.snapshot.latitude = data->latitude;
      state.snapshot.longitude = data->longitude;
      state.snapshot.true_heading_degrees = data->true_heading_degrees;
      state.snapshot.ground_speed_knots = data->ground_speed_knots;
      state.snapshot.source_monotonic_milliseconds =
          monotonic_milliseconds(state);
      break;
    }
    case SIMCONNECT_RECV_ID_QUIT: {
      std::scoped_lock lock(state.snapshot_mutex);
      state.snapshot.connected = 0;
      break;
    }
    case SIMCONNECT_RECV_ID_EXCEPTION: {
      const auto* exception =
          reinterpret_cast<const SIMCONNECT_RECV_EXCEPTION*>(message);
      set_error(
          state,
          "SimConnect exception " + std::to_string(exception->dwException) +
              " at send packet " + std::to_string(exception->dwSendID));
      break;
    }
    default:
      break;
  }
}

bool define_and_request(bridge_state& state) {
  const auto definition = static_cast<SIMCONNECT_DATA_DEFINITION_ID>(
      data_definition::user_aircraft);
  auto add = [&](const char* name,
                 const char* unit,
                 SIMCONNECT_DATATYPE type) {
    return SUCCEEDED(SimConnect_AddToDataDefinition(
        state.simconnect, definition, name, unit, type));
  };

  if (!add("PLANE LATITUDE", "degrees", SIMCONNECT_DATATYPE_FLOAT64) ||
      !add("PLANE LONGITUDE", "degrees", SIMCONNECT_DATATYPE_FLOAT64) ||
      !add(
          "PLANE HEADING DEGREES TRUE",
          "degrees",
          SIMCONNECT_DATATYPE_FLOAT64) ||
      !add("SIM ON GROUND", "bool", SIMCONNECT_DATATYPE_INT32) ||
      !add("GROUND VELOCITY", "knots", SIMCONNECT_DATATYPE_FLOAT64)) {
    set_error(state, "One or more telemetry data definitions were rejected.");
    return false;
  }

  const auto request =
      static_cast<SIMCONNECT_DATA_REQUEST_ID>(data_request::user_aircraft);
  if (FAILED(SimConnect_RequestDataOnSimObject(
          state.simconnect,
          request,
          definition,
          SIMCONNECT_OBJECT_ID_USER,
          SIMCONNECT_PERIOD_VISUAL_FRAME,
          SIMCONNECT_DATA_REQUEST_FLAG_CHANGED))) {
    set_error(state, "The user-aircraft telemetry request was rejected.");
    return false;
  }
  return true;
}

void close_connection(bridge_state& state) {
  if (state.simconnect != nullptr) {
    SimConnect_Close(state.simconnect);
    state.simconnect = nullptr;
  }
  std::scoped_lock lock(state.snapshot_mutex);
  state.snapshot.connected = 0;
}

void owner_loop(bridge_state& state) {
  auto retry_delay = 250ms;
  while (!state.stop_requested.load(std::memory_order_acquire)) {
    if (state.simconnect == nullptr) {
      const HRESULT result = SimConnect_Open(
          &state.simconnect,
          "TaxiNow",
          nullptr,
          0,
          nullptr,
          0);
      if (FAILED(result)) {
        set_error(
            state,
            "SimConnect_Open failed; waiting for a simulator.");
        std::this_thread::sleep_for(retry_delay);
        retry_delay = std::min(retry_delay * 2, 5s);
        continue;
      }
      retry_delay = 250ms;
      if (!define_and_request(state)) {
        close_connection(state);
        std::this_thread::sleep_for(retry_delay);
        continue;
      }
    }

    if (FAILED(SimConnect_CallDispatch(state.simconnect, dispatch, &state))) {
      set_error(state, "SimConnect dispatch failed; reconnecting.");
      close_connection(state);
      continue;
    }
    std::this_thread::sleep_for(4ms);
  }
  close_connection(state);
}
#else
void owner_loop(bridge_state& state) {
  set_error(
      state,
      "This DLL is an ABI stub built without an MSFS SimConnect SDK.");
  while (!state.stop_requested.load(std::memory_order_acquire)) {
    std::this_thread::sleep_for(100ms);
  }
}
#endif

bridge_state* from_handle(taxinow_simconnect_handle handle) {
  return static_cast<bridge_state*>(handle);
}
}  // namespace

taxinow_simconnect_handle taxinow_simconnect_create(void) {
  try {
    return new bridge_state();
  } catch (...) {
    return nullptr;
  }
}

int32_t taxinow_simconnect_start(taxinow_simconnect_handle handle) {
  auto* state = from_handle(handle);
  if (state == nullptr) {
    return 1;
  }
  bool expected = false;
  if (!state->running.compare_exchange_strong(expected, true)) {
    return 2;
  }
  state->stop_requested.store(false, std::memory_order_release);
  state->started_at = steady_clock::now();
  try {
    state->owner_thread = std::thread(owner_loop, std::ref(*state));
    return 0;
  } catch (...) {
    state->running.store(false, std::memory_order_release);
    set_error(*state, "The SimConnect owner thread could not be created.");
    return 3;
  }
}

void taxinow_simconnect_stop(taxinow_simconnect_handle handle) {
  auto* state = from_handle(handle);
  if (state == nullptr) {
    return;
  }
  state->stop_requested.store(true, std::memory_order_release);
  if (state->owner_thread.joinable()) {
    state->owner_thread.join();
  }
  state->running.store(false, std::memory_order_release);
}

int32_t taxinow_simconnect_latest(
    taxinow_simconnect_handle handle,
    taxinow_telemetry_snapshot* snapshot) {
  auto* state = from_handle(handle);
  if (state == nullptr || snapshot == nullptr) {
    return 1;
  }
  if (snapshot->size != sizeof(taxinow_telemetry_snapshot) ||
      snapshot->abi_version != TAXINOW_SIMCONNECT_ABI_VERSION) {
    return 2;
  }
  std::scoped_lock lock(state->snapshot_mutex);
  *snapshot = state->snapshot;
  return 0;
}

int32_t taxinow_simconnect_last_error(
    taxinow_simconnect_handle handle,
    char* buffer,
    uint32_t buffer_size) {
  auto* state = from_handle(handle);
  if (state == nullptr || buffer == nullptr || buffer_size == 0) {
    return 1;
  }
  std::scoped_lock lock(state->error_mutex);
  const auto count = std::min(
      static_cast<size_t>(buffer_size - 1),
      state->last_error.size());
  std::memcpy(buffer, state->last_error.data(), count);
  buffer[count] = '\0';
  return 0;
}

void taxinow_simconnect_destroy(taxinow_simconnect_handle handle) {
  auto* state = from_handle(handle);
  if (state == nullptr) {
    return;
  }
  taxinow_simconnect_stop(handle);
  delete state;
}

