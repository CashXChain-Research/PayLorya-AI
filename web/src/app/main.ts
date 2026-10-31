import { initChrome } from "../shared/nav.js";
import { initCompose, loadSamples } from "./compose.js";
import { initDetail, select, selectedId } from "./detail.js";
import { loadHealth } from "./health.js";
import { initList, loadList } from "./list.js";

initChrome();
initList(id => void select(id), selectedId);
initDetail();
initCompose();

void loadHealth();
void loadSamples();
void loadList();
setInterval(() => void loadList(), 4000);
