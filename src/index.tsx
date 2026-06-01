import { definePlugin, routerHook } from "@decky/api";
import { staticClasses, Navigation, PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { FaTv } from "react-icons/fa";

const ROUTE = "/trailer-tv";

function SpikeFullscreen() {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "black", color: "white",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48, zIndex: 99999,
    }}
      onClick={() => Navigation.NavigateBack()}
    >
      Trailer TV spike - press any input / click to exit
    </div>
  );
}

function QamSpike() {
  return (
    <PanelSection title="Trailer TV (spike)">
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => Navigation.Navigate(ROUTE)}>
          Open fullscreen
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

export default definePlugin(() => {
  routerHook.addRoute(ROUTE, SpikeFullscreen, { exact: true });
  // Spike: log every global key/gamepad event to confirm listeners fire in Game Mode.
  const onInput = (e: Event) => console.log("[trailer-tv-spike] input:", e.type);
  window.addEventListener("keydown", onInput, true);
  window.addEventListener("mousemove", onInput, true);

  return {
    name: "Trailer TV",
    titleView: <div className={staticClasses.Title}>Trailer TV</div>,
    content: <QamSpike />,
    icon: <FaTv />,
    onDismount() {
      routerHook.removeRoute(ROUTE);
      window.removeEventListener("keydown", onInput, true);
      window.removeEventListener("mousemove", onInput, true);
    },
  };
});
