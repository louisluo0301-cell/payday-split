# Automation health visual acceptance

On 2026-11-18, the production dashboard was checked in Microsoft Edge 157 on Windows at widths of 1440, 390 and 320 CSS pixels. The earlier mobile layout measured about 774 pixels across in a 390-pixel viewport. The dashboard now allows its single column to shrink, and the health panel wraps its controls and findings on narrow screens.

The panel shows status and check scope together. Fee credits appear in separate tiles, issues include a written severity, and the session history can be expanded. The dashboard's **View health checks** link jumps directly to the panel.

| Browser scenario | Result |
| --- | --- |
| Demo at desktop and phone widths | No panel overflow; sample data is identified in the status row |
| Demo pause and resume at 390 px, including the recovered state at 320 px | Blocking issue appears and then moves to the recovery history |
| Mock RPC with overdue Reactive fees and low callback funding | Fee tiles and both findings are visible together |
| Mock RPC outage | The panel shows unavailable status and retains previously confirmed issues |
| Mock RPC restored | The panel clears active findings and records recovery; the JSON download contains the latest status and history |
| Unconfigured deployment | The panel gives a demo or configuration next step |

The browser reported zero uncaught errors. The text in these captures uses the dashboard's fallback fonts because the browser run blocked remote font requests. The RPC states are simulated fixtures. Results are in [browser-results.json](browser-results.json).

To review the demo with a keyboard or a narrow window, start the web dashboard, open `/?demo=1#automation-health`, and expand **Recent status changes**. In **Spending controls**, enable pause and save. Clear pause and save again to see the recovery entry.

[Desktop funding alerts](health-desktop-blocked.png) · [Desktop outage](health-desktop-outage.png) · [Phone pause at 390 px](health-mobile-paused.png) · [Phone recovery at 320 px](health-small-mobile.png)
