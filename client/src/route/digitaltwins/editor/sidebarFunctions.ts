import {
  LibraryConfigFile,
  FileState,
} from 'model/backend/interfaces/sharedInterfaces';
import DigitalTwin from 'model/backend/digitalTwin';
import { Dispatch, SetStateAction } from 'react';
import { useDispatch } from 'react-redux';
import LibraryAsset from 'model/backend/libraryAsset';
import { addOrUpdateLibraryFile } from 'model/store/libraryConfigFiles.slice';
import { updateFileState } from 'util/fileUtils';
import {
  fetchAndSetFileContent,
  fetchAndSetFileLibraryContent,
} from 'route/digitaltwins/editor/sidebarFetchers';

export {
  handleAddFileClick,
  handleCloseFileNameDialog,
  handleFileSubmit,
} from 'route/digitaltwins/editor/sidebarDialogHandlers';

export type AssetOrNull = DigitalTwin | LibraryAsset | null;

interface FileStateSetters {
  readonly setFileName: Dispatch<SetStateAction<string>>;
  readonly setFileContent: Dispatch<SetStateAction<string>>;
  readonly setFileType: Dispatch<SetStateAction<string>>;
  readonly setFilePrivacy: Dispatch<SetStateAction<string>>;
  readonly setIsLibraryFile: Dispatch<SetStateAction<boolean>>;
  readonly setLibraryAssetPath: Dispatch<SetStateAction<string>>;
}

interface FileClickOptions {
  readonly dispatch?: ReturnType<typeof useDispatch>;
  readonly library?: boolean;
  readonly libraryFiles?: LibraryConfigFile[];
  readonly assetPath?: string;
}

export const handleFileClick = (
  fileName: string,
  asset: AssetOrNull,
  setters: FileStateSetters,
  files: FileState[],
  tab: string,
  options?: FileClickOptions,
) => {
  if (tab === 'create') {
    handleCreateFileClick(
      fileName,
      asset,
      files,
      setters,
      options?.dispatch,
      options?.libraryFiles,
    );
  } else if (tab === 'reconfigure') {
    handleReconfigureFileClick(
      fileName,
      asset,
      files,
      setters,
      options?.dispatch,
      options?.library,
      options?.libraryFiles,
      options?.assetPath,
    );
  }
};

export const handleCreateFileClick = (
  fileName: string,
  asset: AssetOrNull,
  files: FileState[],
  setters: FileStateSetters,
  dispatch?: ReturnType<typeof useDispatch>,
  libraryFiles?: LibraryConfigFile[],
) => {
  if (asset instanceof DigitalTwin || asset === null) {
    const newFile = files.find((file) => file.name === fileName && file.isNew);
    if (newFile) {
      updateFileState({
        fileName: newFile.name,
        fileContent: newFile.content,
        setFileName: setters.setFileName,
        setFileContent: setters.setFileContent,
        setFileType: setters.setFileType,
        setFilePrivacy: setters.setFilePrivacy,
      });
      setters.setIsLibraryFile(false);
      setters.setLibraryAssetPath('');
    }
  } else {
    const libraryFile = libraryFiles!.find(
      (file) =>
        file.fileName === fileName &&
        file.assetPath === asset.path &&
        file.isPrivate === asset.isPrivate,
    );
    if (libraryFile?.isModified) {
      updateFileState({
        fileName: libraryFile.fileName,
        fileContent: libraryFile.fileContent,
        setFileName: setters.setFileName,
        setFileContent: setters.setFileContent,
        setFileType: setters.setFileType,
        setFilePrivacy: setters.setFilePrivacy,
        isPrivate: asset.isPrivate,
      });
      setters.setIsLibraryFile(true);
      setters.setLibraryAssetPath(libraryFile.assetPath);
    } else {
      fetchAndSetFileLibraryContent({
        fileName: libraryFile!.fileName,
        libraryAsset: asset,
        setFileName: setters.setFileName,
        setFileContent: setters.setFileContent,
        setFileType: setters.setFileType,
        setFilePrivacy: setters.setFilePrivacy,
        isNew: true,
        setIsLibraryFile: setters.setIsLibraryFile,
        setLibraryAssetPath: setters.setLibraryAssetPath,
        dispatch,
      });
    }
  }
};

export const handleReconfigureFileClick = async (
  fileName: string,
  asset: AssetOrNull,
  files: FileState[],
  setters: FileStateSetters,
  dispatch?: ReturnType<typeof useDispatch>,
  library?: boolean,
  libraryFiles?: LibraryConfigFile[],
  assetPath?: string,
) => {
  if (asset instanceof DigitalTwin || asset === null) {
    if (library === undefined) {
      const modifiedFile = files.find(
        (file) => file.name === fileName && file.isModified && !file.isNew,
      );
      if (modifiedFile) {
        updateFileState({
          fileName: modifiedFile.name,
          fileContent: modifiedFile.content,
          setFileName: setters.setFileName,
          setFileContent: setters.setFileContent,
          setFileType: setters.setFileType,
          setFilePrivacy: setters.setFilePrivacy,
        });
      } else {
        fetchAndSetFileContent(
          fileName,
          asset,
          setters.setFileName,
          setters.setFileContent,
          setters.setFileType,
          setters.setFilePrivacy,
        );
      }
      setters.setIsLibraryFile(false);
      setters.setLibraryAssetPath('');
    } else {
      const modifiedLibraryFile = libraryFiles!.find(
        (file) => file.fileName === fileName && file.assetPath === assetPath,
      );
      if (modifiedLibraryFile?.isModified) {
        updateFileState({
          fileName: modifiedLibraryFile.fileName,
          fileContent: modifiedLibraryFile.fileContent,
          setFileName: setters.setFileName,
          setFileContent: setters.setFileContent,
          setFileType: setters.setFileType,
          setFilePrivacy: setters.setFilePrivacy,
        });
      } else {
        fetchAndSetFileContent(
          fileName,
          asset,
          setters.setFileName,
          setters.setFileContent,
          setters.setFileType,
          setters.setFilePrivacy,
          library,
          assetPath,
        );
        const fileContent = await asset!.DTAssets.getLibraryFileContent(
          assetPath!,
          fileName,
        );
        dispatch!(
          addOrUpdateLibraryFile({
            assetPath: assetPath!,
            fileName,
            fileContent,
            isNew: false,
            isModified: false,
            isPrivate: true,
          }),
        );
      }
      setters.setIsLibraryFile(true);
      setters.setLibraryAssetPath(assetPath!);
    }
  }
};
