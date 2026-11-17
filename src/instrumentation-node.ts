import { startOverlay } from "./server/connections";

/** Never able to stop the server from starting: without the overlay the environment alone keeps working. */
export async function startConnections(): Promise<void> {
  try {
    await startOverlay();
  } catch {
    // the environment alone keeps working
  }
}

void startConnections();
