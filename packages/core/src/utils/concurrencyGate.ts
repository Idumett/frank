export class ConcurrencyGateError extends Error {
  constructor(message: string, readonly code: 'queue_full' | 'queue_timeout') {
    super(message);
    this.name = 'ConcurrencyGateError';
  }
}

type WaitingTask<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  timer?: NodeJS.Timeout;
};

export class ConcurrencyGate {
  private active = 0;
  private readonly waiting: WaitingTask<any>[] = [];

  constructor(private readonly options: {
    maxConcurrent: number;
    maxQueue: number;
    queueTimeoutMs: number;
  }) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1)
      throw new Error('maxConcurrent must be at least 1');
    if (!Number.isInteger(options.maxQueue) || options.maxQueue < 0)
      throw new Error('maxQueue cannot be negative');
    if (!Number.isFinite(options.queueTimeoutMs) || options.queueTimeoutMs < 1)
      throw new Error('queueTimeoutMs must be positive');
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.options.maxConcurrent)
      return new Promise<T>((resolve, reject) => this.start({ task, resolve, reject }));
    if (this.waiting.length >= this.options.maxQueue)
      return Promise.reject(new ConcurrencyGateError('Provider queue is full', 'queue_full'));

    return new Promise<T>((resolve, reject) => {
      const item: WaitingTask<T> = { task, resolve, reject };
      item.timer = setTimeout(() => {
        const index = this.waiting.indexOf(item);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        reject(new ConcurrencyGateError('Provider queue wait expired', 'queue_timeout'));
      }, this.options.queueTimeoutMs);
      item.timer.unref();
      this.waiting.push(item);
    });
  }

  snapshot() {
    return { active: this.active, queued: this.waiting.length };
  }

  private start<T>(item: WaitingTask<T>) {
    if (item.timer) clearTimeout(item.timer);
    this.active += 1;
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        this.active -= 1;
        const next = this.waiting.shift();
        if (next) this.start(next);
      });
  }
}
