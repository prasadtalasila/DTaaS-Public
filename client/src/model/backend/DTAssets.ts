import {
  BackendInterface,
  CommitAction,
} from 'model/backend/interfaces/backendInterfaces';
import {
  DTAssetsInterface,
  FileHandlerInterface,
  FileState,
  FileType,
  NewFileInput,
} from 'model/backend/interfaces/sharedInterfaces';
import FileHandler from 'model/backend/fileHandler';

export function getFilePath(
  file: FileState,
  mainFolderPath: string,
  lifecycleFolderPath: string,
): string {
  return file.type === FileType.LIFECYCLE
    ? lifecycleFolderPath
    : mainFolderPath;
}

function resolveCreateFilePath(
  file: NewFileInput,
  mainFolderPath: string,
  lifecycleFolderPath: string,
): string {
  const fileType = (file as FileState).type;
  const mainPath = file.isFromCommonLibrary
    ? `${mainFolderPath}/common`
    : mainFolderPath;
  const lifecyclePath = file.isFromCommonLibrary
    ? `${mainPath}/lifecycle`
    : lifecycleFolderPath;
  return fileType === FileType.LIFECYCLE ? lifecyclePath : mainPath;
}

class DTAssets implements DTAssetsInterface {
  public DTName: string;

  public backend: BackendInterface;

  public fileHandler: FileHandlerInterface;

  constructor(DTName: string, backend: BackendInterface) {
    this.DTName = DTName;
    this.backend = backend;
    this.fileHandler = new FileHandler(DTName, backend);
  }

  buildCreateFileActions(
    files: NewFileInput[],
    mainFolderPath: string,
    lifecycleFolderPath: string,
  ): CommitAction[] {
    return files
      .filter((file): file is NewFileInput => file.isNew)
      .map((file) => ({
        action: 'create' as const,
        filePath: `${resolveCreateFilePath(file, mainFolderPath, lifecycleFolderPath)}/${file.name}`,
        content: file.content,
      }));
  }

  async buildTriggerAction(): Promise<CommitAction | null> {
    const filePath = `.gitlab-ci.yml`;
    const fileContent = await this.fileHandler.getFileContent(filePath);

    const triggerKey = `trigger_${this.DTName}`;
    if (fileContent.includes(triggerKey)) {
      return null;
    }

    const triggerContent = `
${triggerKey}:
  stage: triggers
  trigger:
    include: digital_twins/${this.DTName}/.gitlab-ci.yml
  rules:
    - if: '$DTName == "${this.DTName}"'
      when: always
  variables:
    RunnerTag: $RunnerTag
`;

    const updatedContent = `${fileContent.trimEnd()}\n${triggerContent}`;

    return {
      action: 'update' as const,
      filePath,
      content: updatedContent,
    };
  }

  async createFiles(
    files: NewFileInput[],
    mainFolderPath: string,
    lifecycleFolderPath: string,
  ): Promise<void> {
    const newFiles = files.filter(
      (file): file is NewFileInput => file.isNew,
    );

    await Promise.all(
      newFiles.map(async (file) => {
        const filePath = resolveCreateFilePath(
          file,
          mainFolderPath,
          lifecycleFolderPath,
        );
        const fileType = (file as FileState).type;
        const commitMessage = `Add ${file.name} to ${fileType} folder`;
        await this.fileHandler.createFile(file, filePath, commitMessage);
      }),
    );
  }

  async getFilesFromAsset(assetPath: string, isPrivate: boolean) {
    try {
      const fileNames = await this.fileHandler.getLibraryFileNames(
        assetPath,
        isPrivate,
      );

      const filePromises = fileNames.map(async (fileName) => {
        const fileContent = await this.fileHandler.getFileContent(
          `${assetPath}/${fileName}`,
          isPrivate,
        );

        return {
          name: fileName,
          content: fileContent,
          path: assetPath,
          isPrivate,
        };
      });

      const files = await Promise.all(filePromises);
      return files;
    } catch (error) {
      throw new Error(
        `Error fetching files from asset at ${assetPath}: ${error}`,
      );
    }
  }

  async updateFileContent(
    fileName: string,
    fileContent: string,
  ): Promise<void> {
    const hasExtension = fileName.includes('.');

    const filePath = hasExtension
      ? `digital_twins/${this.DTName}/${fileName}`
      : `digital_twins/${this.DTName}/lifecycle/${fileName}`;

    const commitMessage = `Update ${fileName} content`;

    await this.fileHandler.updateFile(filePath, fileContent, commitMessage);
  }

  async updateLibraryFileContent(
    fileName: string,
    fileContent: string,
    assetPath: string,
  ): Promise<void> {
    const filePath = `${assetPath}/${fileName}`;
    const commitMessage = `Update ${fileName} content`;

    await this.fileHandler.updateFile(filePath, fileContent, commitMessage);
  }

  async appendTriggerToPipeline(): Promise<string> {
    const filePath = `.gitlab-ci.yml`;

    try {
      const fileContent = await this.fileHandler.getFileContent(filePath);

      const triggerKey = `trigger_${this.DTName}`;
      if (fileContent.includes(triggerKey)) {
        return `Trigger already exists in the pipeline for ${this.DTName}`;
      }

      const triggerContent = `
${triggerKey}:
  stage: triggers
  trigger:
    include: digital_twins/${this.DTName}/.gitlab-ci.yml
  rules:
    - if: '$DTName == "${this.DTName}"'
      when: always
  variables:
    RunnerTag: $RunnerTag
`;

      const updatedContent = `${fileContent.trimEnd()}\n${triggerContent}`;

      const commitMessage = `Add trigger for ${this.DTName} to .gitlab-ci.yml`;
      await this.fileHandler.updateFile(
        filePath,
        updatedContent,
        commitMessage,
      );

      return `Trigger appended to pipeline for ${this.DTName}`;
    } catch (error) {
      return `Error appending trigger to pipeline: ${error}`;
    }
  }

  async removeTriggerFromPipeline(): Promise<string> {
    const filePath = `.gitlab-ci.yml`;

    try {
      const fileContent = await this.fileHandler.getFileContent(filePath);

      const triggerPattern = new RegExp(
        `\\n?\\s*trigger_${this.DTName}:.*?(?=\\n\\s*trigger_|$)`,
        'gs',
      );

      const updatedContent = fileContent.replace(triggerPattern, '');

      if (updatedContent === fileContent) {
        return `No trigger found for ${this.DTName} in ${filePath}`;
      }

      const commitMessage = `Remove trigger for ${this.DTName} from .gitlab-ci.yml`;
      await this.fileHandler.updateFile(
        filePath,
        updatedContent,
        commitMessage,
      );
      return `Trigger removed from pipeline for ${this.DTName}`;
    } catch (error) {
      return `Error removing trigger from pipeline: ${error}`;
    }
  }

  async delete(): Promise<void> {
    await this.removeTriggerFromPipeline();
    await this.fileHandler.deleteDT(`digital_twins/${this.DTName}`);

    const libraryDTs =
      await this.fileHandler.getFolders(`common/digital_twins`);
    if (libraryDTs.includes(`common/digital_twins/${this.DTName}`)) {
      await this.fileHandler.deleteDT(`common/digital_twins/${this.DTName}`);
    }
  }

  async getFileContent(fileName: string): Promise<string> {
    const isFileWithoutExtension = !fileName.includes('.');

    const filePath = isFileWithoutExtension
      ? `digital_twins/${this.DTName}/lifecycle/${fileName}`
      : `digital_twins/${this.DTName}/${fileName}`;

    const fileContent = await this.fileHandler.getFileContent(filePath);

    return fileContent;
  }

  async getLibraryFileContent(
    assetPath: string,
    fileName: string,
  ): Promise<string> {
    const filePath = `${assetPath}/${fileName}`;
    return this.fileHandler.getFileContent(filePath);
  }

  async getFileNames(fileType: FileType): Promise<string[]> {
    return this.fileHandler.getFileNames(fileType);
  }

  async getLibraryConfigFileNames(filePath: string): Promise<string[]> {
    return this.fileHandler.getLibraryConfigFileNames(filePath, true);
  }

  async getFolders(path: string): Promise<string[]> {
    return this.fileHandler.getFolders(path);
  }
}

export default DTAssets;
