cmake_minimum_required(VERSION 3.25)
project(TaxiNowSimConnectNative LANGUAGES CXX)

option(TAXINOW_WITH_SIMCONNECT "Build against an installed MSFS SDK" ON)
set(MSFS_SDK_ROOT "" CACHE PATH "Root of the selected Microsoft Flight Simulator SDK")

add_library(TaxiNow.SimConnect.Native SHARED
  include/taxinow_simconnect.h
  src/taxinow_simconnect.cpp)
target_compile_features(TaxiNow.SimConnect.Native PRIVATE cxx_std_20)
target_compile_definitions(TaxiNow.SimConnect.Native PRIVATE
  TAXINOW_SIMCONNECT_EXPORTS
  WIN32_LEAN_AND_MEAN
  NOMINMAX)
target_include_directories(TaxiNow.SimConnect.Native PUBLIC include)
set_target_properties(TaxiNow.SimConnect.Native PROPERTIES
  OUTPUT_NAME "TaxiNow.SimConnect.Native")

if(TAXINOW_WITH_SIMCONNECT)
  if(NOT MSFS_SDK_ROOT)
    message(FATAL_ERROR "Set MSFS_SDK_ROOT to the SDK edition being verified.")
  endif()
  set(SIMCONNECT_ROOT "${MSFS_SDK_ROOT}/SimConnect SDK")
  if(NOT EXISTS "${SIMCONNECT_ROOT}/include/SimConnect.h")
    message(FATAL_ERROR "SimConnect.h was not found below MSFS_SDK_ROOT.")
  endif()
  target_compile_definitions(TaxiNow.SimConnect.Native PRIVATE TAXINOW_WITH_SIMCONNECT=1)
  target_include_directories(TaxiNow.SimConnect.Native PRIVATE "${SIMCONNECT_ROOT}/include")
  target_link_libraries(TaxiNow.SimConnect.Native PRIVATE
    "${SIMCONNECT_ROOT}/lib/SimConnect.lib")

  add_executable(TaxiNow.SimConnect.FacilitySpike
    spikes/facility_spike.cpp)
  target_compile_features(TaxiNow.SimConnect.FacilitySpike PRIVATE cxx_std_20)
  target_compile_definitions(TaxiNow.SimConnect.FacilitySpike PRIVATE
    WIN32_LEAN_AND_MEAN
    NOMINMAX)
  target_include_directories(TaxiNow.SimConnect.FacilitySpike PRIVATE
    "${SIMCONNECT_ROOT}/include")
  target_link_libraries(TaxiNow.SimConnect.FacilitySpike PRIVATE
    "${SIMCONNECT_ROOT}/lib/SimConnect.lib")
endif()

install(TARGETS TaxiNow.SimConnect.Native
  RUNTIME DESTINATION .
  LIBRARY DESTINATION .
  ARCHIVE DESTINATION lib)

