#pragma once

#include <stdint.h>

#if defined(_WIN32) && defined(TAXINOW_SIMCONNECT_EXPORTS)
#define TAXINOW_API extern "C" __declspec(dllexport)
#elif defined(_WIN32)
#define TAXINOW_API extern "C" __declspec(dllimport)
#else
#define TAXINOW_API extern "C"
#endif

#define TAXINOW_SIMCONNECT_ABI_VERSION 1u

typedef void* taxinow_simconnect_handle;

typedef struct taxinow_telemetry_snapshot {
  uint32_t size;
  uint32_t abi_version;
  uint64_t sequence;
  int32_t connected;
  int32_t on_ground;
  double latitude;
  double longitude;
  double true_heading_degrees;
  double ground_speed_knots;
  int64_t source_monotonic_milliseconds;
  int32_t simulator_edition;
} taxinow_telemetry_snapshot;

// Return values are zero on success. The bridge owns exactly one SimConnect
// thread; callers only copy immutable snapshots.
TAXINOW_API taxinow_simconnect_handle taxinow_simconnect_create(void);
TAXINOW_API int32_t taxinow_simconnect_start(taxinow_simconnect_handle handle);
TAXINOW_API void taxinow_simconnect_stop(taxinow_simconnect_handle handle);
TAXINOW_API int32_t taxinow_simconnect_latest(
    taxinow_simconnect_handle handle,
    taxinow_telemetry_snapshot* snapshot);
TAXINOW_API int32_t taxinow_simconnect_last_error(
    taxinow_simconnect_handle handle,
    char* buffer,
    uint32_t buffer_size);
TAXINOW_API void taxinow_simconnect_destroy(taxinow_simconnect_handle handle);

