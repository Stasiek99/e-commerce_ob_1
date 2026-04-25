import { correlationIdStorage, getCorrelationId } from '../correlation-id.storage';

describe('correlationIdStorage', () => {
  it('returns undefined outside a storage context', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('returns the stored ID inside a run() callback', (done) => {
    correlationIdStorage.run('test-id-123', () => {
      expect(getCorrelationId()).toBe('test-id-123');
      done();
    });
  });

  it('isolates IDs across nested run() calls', (done) => {
    correlationIdStorage.run('outer', () => {
      expect(getCorrelationId()).toBe('outer');

      correlationIdStorage.run('inner', () => {
        expect(getCorrelationId()).toBe('inner');
      });

      // outer context is restored after inner run exits
      expect(getCorrelationId()).toBe('outer');
      done();
    });
  });

  it('does not leak IDs between sequential run() calls', async () => {
    await new Promise<void>((resolve) => correlationIdStorage.run('first', resolve));
    expect(getCorrelationId()).toBeUndefined();
  });
});
