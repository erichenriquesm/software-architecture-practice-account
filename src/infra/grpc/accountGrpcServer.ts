import grpc from '@grpc/grpc-js';
import type { AccountExists } from '../../application/usecases/accountExists.js';
import { InvalidAccountDataError } from '../../domain/errors.js';
import type { AccountServiceServer } from '../generated/account.js';
import { AccountServiceService } from '../generated/account.js';
import { serviceTokenInterceptor } from '../platform/security/serviceAuth.js';

const statusFor = (error: unknown): grpc.status =>
  error instanceof InvalidAccountDataError ? grpc.status.INVALID_ARGUMENT : grpc.status.INTERNAL;

const implementation = (accountExists: AccountExists): AccountServiceServer => ({
  exists: (call, callback) => {
    accountExists
      .execute(call.request.accountId)
      .then((exists) => callback(null, { exists }))
      .catch((error: unknown) => callback({ code: statusFor(error), details: String(error) }));
  },
});

export interface AccountGrpcServerOptions {
  readonly accountExists: AccountExists;
  readonly token: string;
  readonly address: string;
  readonly onDenied?: (method: string) => void;
}

export const startAccountGrpcServer = async (options: AccountGrpcServerOptions): Promise<{ server: grpc.Server; port: number }> => {
  const server = new grpc.Server({ interceptors: [serviceTokenInterceptor(options.token, options.onDenied)] });
  server.addService(AccountServiceService, implementation(options.accountExists));
  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync(options.address, grpc.ServerCredentials.createInsecure(), (error, boundPort) =>
      error ? reject(error) : resolve(boundPort),
    ),
  );
  return { server, port };
};
