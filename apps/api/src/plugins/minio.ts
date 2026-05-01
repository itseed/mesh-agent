import fp from 'fastify-plugin';
import { Client as MinioClient } from 'minio';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    minio: MinioClient | null;
    minioBucket: string;
  }
}

export default fp(async function minioPlugin(fastify: FastifyInstance) {
  if (!env.MINIO_ENDPOINT || !env.MINIO_ACCESS_KEY || !env.MINIO_SECRET_KEY) {
    fastify.decorate('minio', null);
    fastify.decorate('minioBucket', env.MINIO_BUCKET);
    fastify.log.warn('MinIO not configured — file upload disabled');
    return;
  }

  const client = new MinioClient({
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
  });

  const bucket = env.MINIO_BUCKET;
  const exists = await client.bucketExists(bucket);
  if (!exists) {
    await client.makeBucket(bucket);
    fastify.log.info({ bucket }, 'MinIO bucket created');
  }

  fastify.decorate('minio', client);
  fastify.decorate('minioBucket', bucket);
});
