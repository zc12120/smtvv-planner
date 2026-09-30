# Mobile interface and shared calculation services

The phone interface now places a compact target summary before the selected
skills, keeps the generate action within reach, and opens the skill picker as a
full-height single-column dialog. Target details and advanced constraints remain
available. A summary identifies non-default restrictions, prices, DLC and skill
sources; changing display size does not change the configuration.

The mobile route overview shows ingredients, result, inherited/granted skills
and the final retained set. Full material and provenance details remain available
per step. Desktop continues to display the full equations. Collections use
compact records on phones and retain the existing previews and detail pages.

## Shared code

- `game_data.py` owns pinned data independently of search and presentation.
- `configuration.py` is the authoritative parser for settings and compute
  requests. Search entry points use the same validation as the coordinator.
- `search_context.py` owns per-request graph inputs and route materialization.
  Bounded enumeration and optimal search compose it without inheriting each
  other's execution state. Independent route replay validation is preserved.
- Completed local requests use canonical conditions, code/data revision and
  engine identity for caching. Identical in-flight requests share an execution
  while retaining independent cancellation and skill presentation order.
  Only new executions consume capacity. Completed tasks release search objects.
- `services.py` constructs application dependencies explicitly; importing the
  HTTP module does not initialize authentication state or a remote queue.
  `PlannerHTTPServer(..., services=...)` supports isolated application instances.
- `persistence.py` centralizes file locks, atomic JSON writes and generation
  publication while retaining per-file permissions and durable pointer swaps.
- Turnstile performs external verification outside configuration locks and
  rechecks the revision before accepting verification or publishing settings.
- Coordinator response projection and result encoding occur outside its database
  lock; lease checks and state changes remain transactional.
- `web/task-controller.js` owns request identity, phases, cancellation generations
  and polling. The shared transport defaults to one attempt; calculation requests
  opt into retries with idempotent request IDs.
- `web/auth/theme/common.js` supplies transport, preferences and Turnstile loading
  for the planner, details, login and administration pages.
- `web/components.css` owns planner controls and their responsive layout. Their
  old declarations were removed from the historical theme files. Other components
  continue using the existing styles until they need to be migrated.

## Building and checking

After changing page scripts or styles, run `npm run build:web`. The icon subset
is rebuilt and `scripts/build_web.py` generates the common loader from
`scripts/web_assets.json` and `scripts/templates/bootstrap.js`, then versions
local page assets by content. HTML files and `web/bootstrap.js` are committed
outputs so normal users do not need a frontend toolchain to run the app.

Run `python3 -m unittest discover -s tests` for backend checks. Existing public,
on-demand, collection, localization, route and administration browser checks
continue to cover their respective workflows. `npm run test:mobile` adds
Chromium/WebKit phone checks for three interface languages, standard/large text,
three skins and both color modes. It also checks hidden constraints, actual
calculation, previews, touch targets and the skill dialog's scroll area.

## Deployment

Build and test a candidate before replacing the serving version. A code/data
revision change requires matching coordinator and remote worker versions.
Preserve existing private runtime configuration, account/state volumes and the
deployment's Compose project name. For mounted web assets, recreate affected
containers after switching the release directory; changing a symlink alone does
not update an existing bind mount reliably. Keep the previous release and image
for rollback. Roll code back without overwriting live account state with an old
snapshot.

The default public deployment remains standalone. Remote worker hostnames,
credentials, private release records and state backups are deployment-specific
and must remain outside the public source tree.
