import supertest from 'supertest';
import { INestApplication, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Keyv from 'keyv';
import AppModule from 'src/app.module';
import Config from 'src/config/configuration.service';
import FsmService from 'src/fsm/fsm.service';

// Starts the runner as main.ts does, with the configuration file given
export async function startRunner(
  configFile: string,
): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication({ logger: false });
  const options = new Keyv();
  await options.set('configFile', configFile);
  await app.get<Config>(Config).loadConfig(options);
  app.get<FsmService>(FsmService).load();
  await app.init();
  return app;
}

export interface RequestBody {
  name?: string;
  command?: string;
}

type ResponseBody = {
  message?: string;
  error?: string;
  statusCode?: number;
  status?: string;
  name?: string;
  logs?: { stdout: string; stderr: string };
};

type Query = {
  app: INestApplication;
  route: string;
  HttpStatus: number;
  reqBody: RequestBody;
  resBody: ResponseBody | Array<RequestBody>;
};

export async function postRequest(query: Query) {
  return supertest(query.app.getHttpServer())
    .post(query.route)
    .send(query.reqBody)
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json')
    .expect(query.HttpStatus)
    .expect(query.resBody);
}

export async function getRequest(query: Query) {
  return supertest(query.app.getHttpServer())
    .get(query.route)
    .send(query.reqBody)
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json')
    .expect(query.HttpStatus)
    .expect(query.resBody);
}

const invalidQuery = (name: string) => ({
  reqBody: {
    name,
  },
  HttpStatus: HttpStatus.BAD_REQUEST,
  resBody: {
    POST: {
      status: 'invalid command',
    },
    GET: {
      name,
      status: 'invalid',
      logs: { stdout: '', stderr: '' },
    },
  },
});

export const queriesJSON = {
  permitted: {
    reqBody: {
      name: 'create',
    },
    HttpStatus: HttpStatus.OK,
    resBody: {
      POST: {
        status: 'success',
      },
      GET: {
        name: 'create',
        status: 'valid',
        logs: { stdout: 'hello world', stderr: '' },
      },
    },
  },
  notPermitted: invalidQuery('execute'),
  nonExisting: invalidQuery('configure'),
  incorrect: {
    reqBody: {
      command: 'create',
    },
    HttpStatus: HttpStatus.BAD_REQUEST,
    resBody: {
      POST: {
        message: 'Validation Failed',
        error: 'Bad Request',
        statusCode: 400,
      },
      GET: {
        name: 'none',
        status: 'invalid',
        logs: { stdout: '', stderr: '' },
      },
    },
  },
};
