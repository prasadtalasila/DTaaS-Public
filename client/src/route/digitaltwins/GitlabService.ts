import { GitlabInstance } from 'util/gitlab';
import { getAuthority } from 'util/envUtil';
import { Asset } from '../../components/asset/Asset';

class GitlabService {
  private gitlabInstance: GitlabInstance;

  constructor() {
    this.gitlabInstance = new GitlabInstance(
      sessionStorage.getItem('username') || '',
      getAuthority(),
      sessionStorage.getItem('access_token') || '',
    );
  }

  async getSubfolders(): Promise<Asset[] | string> {
    try {
      if (!this.gitlabInstance) {
        throw new Error('GitlabInstance is not initialized');
      }
      await this.gitlabInstance.init();
      if (this.gitlabInstance.projectId) {
        return this.gitlabInstance.getDTSubfolders(
          this.gitlabInstance.projectId,
        );
      }
      return [];
    } catch (error) {
      return 'An error occurred';
    }
  }

  getInstance(): GitlabInstance {
    return this.gitlabInstance;
  }
}

export default GitlabService;