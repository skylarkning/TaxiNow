# TaxiNow map pipeline

This standalone Python 3.12+ component implements the versioned JSON-lines
boundary used by `TaxiNow.Pipeline`. It uses only the standard library so it can
be packaged with PyInstaller.

Development:

```powershell
python .\tools\map_pipeline\taxinow_map_pipeline.py serve
```

Send one JSON request on standard input. Progress and completion events are
written to standard output. Source responses and negative results are cached
separately from normalized assets.

The current acquisition slice uses the OurAirports catalog to locate airports
and OpenStreetMap/Overpass for geometry. X-Plane and simulator-facility merging
remain explicit later source adapters.

