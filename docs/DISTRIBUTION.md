# Windows distribution

TaxiNow should ship in two forms:

1. A signed Windows installer is the primary release for most users.
2. A portable ZIP is a secondary release for advanced users and troubleshooting.

The installer should install TaxiNow outside the user's map-data directory,
create Start menu and uninstall entries, install or detect the Evergreen
Microsoft Edge WebView2 Runtime, preserve user data during upgrades, and limit
any Windows Firewall rule to private networks. Future releases should support
in-place upgrades. The release executable and installer should be code signed
before public distribution.

The portable ZIP should contain the same self-contained x64 application and
native dependencies, but it cannot provide the same prerequisite checks,
shortcuts, uninstall experience, or reliable upgrade workflow. It should not
store downloaded maps inside the extracted application directory.

## Map-data location

Downloaded airport maps, the SQLite asset catalog, source cache, pipeline
working files, and logs belong in a user-writable data directory rather than
the installation directory. TaxiNow defaults to:

```text
%LocalAppData%\TaxiNow
```

The Windows app exposes **Maps & storage → Downloaded maps location → Change
folder**. The selected root is saved per Windows user in:

```text
%LocalAppData%\TaxiNow\desktop-settings.json
```

Changing the root requires restarting TaxiNow. Existing data is deliberately
left in the old location: TaxiNow never silently copies or deletes a potentially
large map library. Selecting the old folder restores access to those assets.
The folder picker is a desktop-only capability and is not exposed through the
LAN browser interface.
