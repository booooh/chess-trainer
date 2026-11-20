import { describe, expect, it } from 'vitest';
import { MaiaClient, type WorkerLike } from './maiaClient';
import type { FromWorker, ToWorker } from './maiaProtocol';

class FakeWorker implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = false;
  private listener: ((e: MessageEvent<FromWorker>) => void) | null = null;
  private errorListener: ((e: ErrorEvent) => void) | null = null;
  postMessage(msg: ToWorker) {
    this.sent.push(msg);
  }
  addEventListener(type: 'message' | 'error', fn: (e: never) => void) {
    if (type === 'message') this.listener = fn as (e: MessageEvent<FromWorker>) => void;
    else this.errorListener = fn as (e: ErrorEvent) => void;
  }
  terminate() {
    this.terminated = true;
  }
  reply(msg: FromWorker) {
    this.listener?.({ data: msg } as MessageEvent<FromWorker>);
  }
  crash(message: string) {
    this.errorListener?.({ message } as ErrorEvent);
  }
  lastPredict() {
    return this.sent.filter((m) => m.type === 'predict').at(-1) as Extract<ToWorker, { type: 'predict' }>;
  }
}

const request = { fen: 'startfen', moves: ['e2e4'], selfElo: 1100, oppoElo: 900 };

describe('MaiaClient', () => {
  it('asks the worker to load the model and reports progress until ready', async () => {
    const worker = new FakeWorker();
    const progress: number[] = [];
    const client = new MaiaClient(worker, { onProgress: (loaded, total) => progress.push(loaded / total) });
    expect(worker.sent).toEqual([{ type: 'load' }]);
    worker.reply({ type: 'progress', loaded: 5, total: 10 });
    worker.reply({ type: 'ready' });
    await expect(client.ready).resolves.toBeUndefined();
    expect(progress).toEqual([0.5]);
  });

  it('fails `ready` if the model cannot load', async () => {
    const worker = new FakeWorker();
    const client = new MaiaClient(worker);
    worker.reply({ type: 'loadFailed', message: 'HTTP 404' });
    await expect(client.ready).rejects.toThrow('HTTP 404');
  });

  it('matches each prediction to its request by id', async () => {
    const worker = new FakeWorker();
    const client = new MaiaClient(worker);
    const first = client.predict(request);
    const firstId = worker.lastPredict().id;
    const second = client.predict({ ...request, moves: [] });
    const secondId = worker.lastPredict().id;
    expect(firstId).not.toBe(secondId);
    expect(worker.lastPredict()).toMatchObject({ fen: 'startfen', moves: [], selfElo: 1100, oppoElo: 900 });

    worker.reply({ type: 'prediction', id: secondId, probabilities: [['d2d4', 1]] });
    worker.reply({ type: 'prediction', id: firstId, probabilities: [['e7e5', 0.7], ['c7c5', 0.3]] });
    expect(await first).toEqual(new Map([['e7e5', 0.7], ['c7c5', 0.3]]));
    expect(await second).toEqual(new Map([['d2d4', 1]]));
  });

  it('rejects a prediction that fails in the worker', async () => {
    const worker = new FakeWorker();
    const client = new MaiaClient(worker);
    const p = client.predict(request);
    worker.reply({ type: 'predictionFailed', id: worker.lastPredict().id, message: 'bad FEN' });
    await expect(p).rejects.toThrow('bad FEN');
  });

  it('rejects when the caller aborts, and ignores the late answer', async () => {
    const worker = new FakeWorker();
    const client = new MaiaClient(worker);
    const abort = new AbortController();
    const p = client.predict(request, abort.signal);
    abort.abort();
    await expect(p).rejects.toThrow(/abort/i);
    expect(() => worker.reply({ type: 'prediction', id: worker.lastPredict().id, probabilities: [] })).not.toThrow();
  });

  it('rejects everything pending if the worker crashes', async () => {
    const worker = new FakeWorker();
    const client = new MaiaClient(worker);
    const p = client.predict(request);
    worker.crash('out of memory');
    await expect(p).rejects.toThrow('out of memory');
    await expect(client.ready).rejects.toThrow('out of memory');
  });

  it('terminates the worker when disposed', () => {
    const worker = new FakeWorker();
    new MaiaClient(worker).dispose();
    expect(worker.terminated).toBe(true);
  });
});
