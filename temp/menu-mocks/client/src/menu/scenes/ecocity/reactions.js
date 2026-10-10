// Shared state between the in-engine menu and the world: hovering a menu
// item focuses its landmark; clicking fires a short celebratory burst.
export const reactions = {
  focus: null,
  burst: 0,
  burstId: 0,
};

export function triggerBurst() {
  reactions.burst = 1;
  reactions.burstId += 1;
}
