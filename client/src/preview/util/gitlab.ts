import { Camelize, Gitlab, JobSchema } from '@gitbeaker/rest';
import { Asset } from '../components/asset/Asset';

const GROUP_NAME = 'DTaaS';
const DT_DIRECTORY = 'digital_twins';

interface LogEntry {
  status: string;
  DTName: string;
  runnerTag: string;
  error?: Error;
}

class GitlabInstance {
  public username: string | null;

  public api: InstanceType<typeof Gitlab>;

  public logs: LogEntry[];

  public subfolders: Asset[];

  public projectId: number | null = null;

  public triggerToken: string | null = null;

  constructor(username: string, host: string, oauthToken: string) {
    this.username = username;
    this.api = new Gitlab({
      host,
      oauthToken,
    });
    this.logs = [];
    this.subfolders = [];
  }

  async init() {
    const projectId = await this.getProjectId();
    this.projectId = projectId;

    if (this.projectId !== null) {
      const token = await this.getTriggerToken(this.projectId);
      this.triggerToken = token;
    }
  }

  async getProjectId(): Promise<number | null> {
    let projectId: number | null = null;

    const group = await this.api.Groups.show(GROUP_NAME);
    const projects = await this.api.Groups.allProjects(group.id);
    const project = projects.find((proj) => proj.name === this.username);

    if (project) {
      projectId = project.id;
    }
    return projectId;
  }

  async getTriggerToken(projectId: number): Promise<string | null> {
    let token: string | null = null;

    const triggers = await this.api.PipelineTriggerTokens.all(projectId);

    if (triggers && triggers.length > 0) {
      token = triggers[0].token;
    }
    return token;
  }

  async getDTSubfolders(projectId: number): Promise<Asset[]> {
    const files = await this.api.Repositories.allRepositoryTrees(projectId, {
      path: DT_DIRECTORY,
      recursive: false,
    });

    const subfolders: Asset[] = await Promise.all(
      files
        .filter((file) => file.type === 'tree' && file.path !== DT_DIRECTORY)
        .map(async (file) => ({
          name: file.name,
          path: file.path,
        })),
    );

    this.subfolders = subfolders;
    return subfolders;
  }

  executionLogs(): LogEntry[] {
    return this.logs;
  }

  async getPipelineJobs(
    projectId: number,
    pipelineId: number,
  ): Promise<(JobSchema | Camelize<JobSchema>)[]> {
    const jobs = await this.api.Jobs.all(projectId, { pipelineId });
    return jobs;
  }

  async getJobTrace(projectId: number, jobId: number): Promise<string> {
    const log = await this.api.Jobs.showLog(projectId, jobId);
    return log;
  }

  async getPipelineStatus(
    projectId: number,
    pipelineId: number,
  ): Promise<string> {
    const pipeline = await this.api.Pipelines.show(projectId, pipelineId);
    return pipeline.status;
  }
}

export default GitlabInstance;
