import { initChrome } from "../shared/nav.js";
import { initAssistant } from "./assistant/index.js";
import { initCompose, loadSamples } from "./compose.js";
import { initDetail, select, selectedId } from "./detail.js";
import { loadHealth } from "./health.js";
import { initList, loadList } from "./list.js";
import { initRouter, onRoute } from "./router.js";
import { startAutopilot } from "./settings/autopilot.js";
import { initSettings } from "./settings/view.js";

initChrome();
initList(id => void select(id), selectedId);
initDetail();
initCompose();
initAssistant();
initSettings();

// Deep link from other views: #/inbox?run=<id> opens that run.
onRoute(route => {
  if (route.view === "inbox" && route.run && route.run !== selectedId()) void select(route.run);
});
initRouter();

void loadHealth();
void loadSamples();
void loadList();
setInterval(() => void loadList(), 4000);
startAutopilot();
