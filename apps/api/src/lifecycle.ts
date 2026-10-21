export class ServiceLifecycle {
  private draining = false;
  private shutdownPromise?: Promise<void>;

  get isDraining() {
    return this.draining;
  }

  shutdown(close: () => Promise<void>, cleanup: () => void): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.draining = true;
    this.shutdownPromise = (async () => {
      try {
        await close();
      } finally {
        cleanup();
      }
    })();
    return this.shutdownPromise;
  }
}
