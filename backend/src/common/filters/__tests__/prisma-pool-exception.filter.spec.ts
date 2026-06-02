import { ArgumentsHost } from '@nestjs/common';
import { PrismaClientInitializationError } from '@prisma/client/runtime/library';
import { PrismaPoolExceptionFilter } from '../prisma-pool-exception.filter';

function makeException(message: string): PrismaClientInitializationError {
  const err = new PrismaClientInitializationError(message, '5.0.0');
  return err;
}

function makeHost(statusFn: jest.Mock, jsonFn: jest.Mock): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => ({
        status: statusFn,
        json: jsonFn,
      }),
    }),
  } as unknown as ArgumentsHost;
}

describe('PrismaPoolExceptionFilter', () => {
  let filter: PrismaPoolExceptionFilter;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;

  beforeEach(() => {
    filter = new PrismaPoolExceptionFilter();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('pool timeout errors', () => {
    it('returns 503 when the error message contains "pool timeout"', () => {
      const exception = makeException('pool timeout after 20 seconds');
      const host = makeHost(statusMock, jsonMock);

      filter.catch(exception, host);

      expect(statusMock).toHaveBeenCalledWith(503);
    });

    it('returns Service temporarily unavailable body on pool timeout', () => {
      const exception = makeException('pool timeout after 20 seconds');
      const host = makeHost(statusMock, jsonMock);

      filter.catch(exception, host);

      expect(jsonMock).toHaveBeenCalledWith({ error: 'Service temporarily unavailable' });
    });

    it('matches "pool timeout" anywhere in the message', () => {
      const exception = makeException('Connection refused: pool timeout exceeded');
      const host = makeHost(statusMock, jsonMock);

      filter.catch(exception, host);

      expect(statusMock).toHaveBeenCalledWith(503);
    });
  });

  describe('other initialization errors', () => {
    it('returns 500 for non-pool-timeout initialization errors', () => {
      const exception = makeException('Connection refused at host:5432');
      const host = makeHost(statusMock, jsonMock);

      filter.catch(exception, host);

      expect(statusMock).toHaveBeenCalledWith(500);
    });

    it('returns Internal server error body for non-pool-timeout errors', () => {
      const exception = makeException('Connection refused at host:5432');
      const host = makeHost(statusMock, jsonMock);

      filter.catch(exception, host);

      expect(jsonMock).toHaveBeenCalledWith({ error: 'Internal server error' });
    });

    it('does not return 503 for unrelated initialization errors', () => {
      const exception = makeException('SSL connection error');
      const host = makeHost(statusMock, jsonMock);

      filter.catch(exception, host);

      expect(statusMock).not.toHaveBeenCalledWith(503);
    });
  });
});
