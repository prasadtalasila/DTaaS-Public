import GitlabInstance from './gitlab';

class DigitalTwin {
    public DTName: string;

    public gitlabInstance: GitlabInstance;

    private lastExecutionStatus: string | null = null;

    constructor(DTName: string, gitlabInstance: GitlabInstance) {
        this.DTName = DTName;
        this.gitlabInstance = gitlabInstance;
    }

    async execute(runnerTag: string): Promise<boolean> {
        const projectId = await this.gitlabInstance.getProjectId();
        if (projectId === null) {
            this.lastExecutionStatus = 'error';
            return false;
        }

        const triggerToken = await this.gitlabInstance.getTriggerToken(projectId);
        if (triggerToken === null) {
            this.lastExecutionStatus = 'error'; 
            return false;
        }

        const variables = {
            DTName: this.DTName,
            RunnerTag: runnerTag,
        }

        try {
            await this.gitlabInstance.api.PipelineTriggerTokens.trigger(
                projectId,
                'main', 
                triggerToken,
                { variables }
            );
            this.gitlabInstance.logs.push({ status: 'success', DTName: this.DTName, runnerTag });
            this.lastExecutionStatus = 'success';
            return true;
        } catch (error) {
            this.gitlabInstance.logs.push({ status: 'error', error: error instanceof Error ? error : new Error(String(error)), DTName: this.DTName, runnerTag });
            this.lastExecutionStatus = 'error'; 
            return false;
        }
    }

    executionStatus(): string | null {
        return this.lastExecutionStatus;
    }
}

export default DigitalTwin;