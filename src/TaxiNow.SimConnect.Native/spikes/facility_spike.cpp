#include <SimConnect.h>
#include <Windows.h>

#include <atomic>
#include <chrono>
#include <iostream>
#include <string>
#include <thread>

namespace {
enum : DWORD {
  kFacilityDefinition = 1,
  kFacilityRequest = 1,
};

std::atomic<bool> finished{false};
std::atomic<bool> failed{false};

void CALLBACK dispatch(SIMCONNECT_RECV* message, DWORD size, void*) {
  if (message == nullptr || size < sizeof(SIMCONNECT_RECV)) {
    return;
  }

  switch (message->dwID) {
    case SIMCONNECT_RECV_ID_OPEN:
      std::cout << "Connected to simulator.\n";
      break;
    case SIMCONNECT_RECV_ID_FACILITY_DATA: {
      const auto* data =
          reinterpret_cast<const SIMCONNECT_RECV_FACILITY_DATA*>(message);
      std::cout << "Facility item type=" << data->Type
                << " item=" << data->ItemIndex + 1
                << "/" << data->ListSize << "\n";
      break;
    }
    case SIMCONNECT_RECV_ID_FACILITY_DATA_END:
      std::cout << "Facility request completed.\n";
      finished.store(true);
      break;
    case SIMCONNECT_RECV_ID_EXCEPTION: {
      const auto* exception =
          reinterpret_cast<const SIMCONNECT_RECV_EXCEPTION*>(message);
      std::cerr << "SimConnect exception=" << exception->dwException
                << " sendId=" << exception->dwSendID << "\n";
      failed.store(true);
      finished.store(true);
      break;
    }
    case SIMCONNECT_RECV_ID_QUIT:
      std::cerr << "Simulator exited.\n";
      failed.store(true);
      finished.store(true);
      break;
    default:
      break;
  }
}

bool add(HANDLE connection, const char* field) {
  const auto definition =
      static_cast<SIMCONNECT_DATA_DEFINITION_ID>(kFacilityDefinition);
  const HRESULT result =
      SimConnect_AddToFacilityDefinition(connection, definition, field);
  if (FAILED(result)) {
    std::cerr << "Definition field rejected: " << field << "\n";
    return false;
  }
  return true;
}
}  // namespace

int main(int argc, char** argv) {
  const std::string icao = argc > 1 ? argv[1] : "CYYZ";
  HANDLE connection = nullptr;
  if (FAILED(SimConnect_Open(
          &connection,
          "TaxiNow Facility Data Spike",
          nullptr,
          0,
          nullptr,
          0))) {
    std::cerr << "SimConnect_Open failed. Start MSFS and retry.\n";
    return 2;
  }

  // This hierarchy intentionally uses only the common airport/runway/taxi
  // subset. Keep the returned field sequence beside the SDK used to build it;
  // do not cast it into production structs until both simulator editions pass.
  const char* fields[] = {
      "OPEN AIRPORT",
      "ICAO",
      "LATITUDE",
      "LONGITUDE",
      "OPEN RUNWAY",
      "LATITUDE",
      "LONGITUDE",
      "HEADING",
      "LENGTH",
      "WIDTH",
      "CLOSE RUNWAY",
      "OPEN TAXI_POINT",
      "TYPE",
      "ORIENTATION",
      "BIAS_X",
      "BIAS_Z",
      "CLOSE TAXI_POINT",
      "OPEN TAXI_PATH",
      "TYPE",
      "WIDTH",
      "WEIGHT_LIMIT",
      "CENTER_LINE",
      "START",
      "END",
      "NAME",
      "CLOSE TAXI_PATH",
      "OPEN TAXI_PARKING",
      "NAME",
      "NUMBER",
      "TYPE",
      "HEADING",
      "RADIUS",
      "BIAS_X",
      "BIAS_Z",
      "CLOSE TAXI_PARKING",
      "OPEN TAXI_NAME",
      "NAME",
      "CLOSE TAXI_NAME",
      "CLOSE AIRPORT"};
  for (const char* field : fields) {
    if (!add(connection, field)) {
      SimConnect_Close(connection);
      return 3;
    }
  }

  const HRESULT request = SimConnect_RequestFacilityData(
      connection,
      static_cast<SIMCONNECT_DATA_DEFINITION_ID>(kFacilityDefinition),
      static_cast<SIMCONNECT_DATA_REQUEST_ID>(kFacilityRequest),
      icao.c_str(),
      "");
  if (FAILED(request)) {
    std::cerr << "Facility request was rejected for " << icao << ".\n";
    SimConnect_Close(connection);
    return 4;
  }

  const auto deadline =
      std::chrono::steady_clock::now() + std::chrono::seconds(30);
  while (!finished.load() && std::chrono::steady_clock::now() < deadline) {
    if (FAILED(SimConnect_CallDispatch(connection, dispatch, nullptr))) {
      std::cerr << "Dispatch failed.\n";
      failed.store(true);
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  if (!finished.load()) {
    std::cerr << "Timed out waiting for facility data.\n";
    failed.store(true);
  }

  SimConnect_Close(connection);
  return failed.load() ? 5 : 0;
}

