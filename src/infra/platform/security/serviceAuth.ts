import { timingSafeEqual } from 'node:crypto';
import grpc from '@grpc/grpc-js';

export const serviceTokenHeader = 'x-service-token';

/** True when the call carries the shared internal token (compared in constant time). */
export const hasServiceToken = (expected: string, metadata: grpc.Metadata): boolean => {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(String(metadata.get(serviceTokenHeader)[0] ?? ''));
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
};

/** Runs before every handler: a call without the shared token ends with UNAUTHENTICATED. */
export const serviceTokenInterceptor =
  (token: string, onDenied: (method: string) => void = () => undefined): grpc.ServerInterceptor =>
  (methodDescriptor, call) =>
    new grpc.ServerInterceptingCall(call, {
      start: (next) =>
        next({
          onReceiveMetadata: (metadata, metadataNext) => {
            if (hasServiceToken(token, metadata)) return metadataNext(metadata);
            onDenied(methodDescriptor.path);
            return call.sendStatus({ code: grpc.status.UNAUTHENTICATED, details: 'missing or wrong service token', metadata: new grpc.Metadata() });
          },
        }),
    });
