import { addOrUpdateLibraryFile } from 'model/store/libraryConfigFiles.slice';
import DigitalTwin from 'model/backend/digitalTwin';
import { updateFileState } from 'util/fileUtils';
import LibraryAsset from 'model/backend/libraryAsset';
import { Dispatch, SetStateAction } from 'react';
import { useDispatch } from 'react-redux';

export const fetchData = async (digitalTwin: DigitalTwin) => {
  await digitalTwin.getDescriptionFiles();
  await digitalTwin.getLifecycleFiles();
  await digitalTwin.getConfigFiles();
  await digitalTwin.getAssetFiles();
};

export const fetchAndSetFileContent = async (
  fileName: string,
  digitalTwin: DigitalTwin | null,
  setFileName: Dispatch<SetStateAction<string>>,
  setFileContent: Dispatch<SetStateAction<string>>,
  setFileType: Dispatch<SetStateAction<string>>,
  setFilePrivacy: Dispatch<SetStateAction<string>>,
  library?: boolean,
  assetPath?: string,
) => {
  try {
    let fileContent;
    if (library) {
      fileContent = await digitalTwin!.DTAssets.getLibraryFileContent(
        assetPath!,
        fileName,
      );
    } else {
      fileContent = await digitalTwin!.DTAssets.getFileContent(fileName);
    }
    if (fileContent) {
      updateFileState({
        fileName,
        fileContent,
        setFileName,
        setFileContent,
        setFileType,
        setFilePrivacy,
      });
    }
  } catch {
    setFileContent(`Error fetching ${fileName} content`);
  }
};

interface LibraryFileParams {
  readonly fileName: string;
  readonly libraryAsset: LibraryAsset | null;
  readonly setFileName: Dispatch<SetStateAction<string>>;
  readonly setFileContent: Dispatch<SetStateAction<string>>;
  readonly setFileType: Dispatch<SetStateAction<string>>;
  readonly setFilePrivacy: Dispatch<SetStateAction<string>>;
  readonly isNew: boolean;
  readonly setIsLibraryFile: Dispatch<SetStateAction<boolean>>;
  readonly setLibraryAssetPath: Dispatch<SetStateAction<string>>;
  readonly dispatch?: ReturnType<typeof useDispatch>;
}

export const fetchAndSetFileLibraryContent = async (
  params: LibraryFileParams,
) => {
  try {
    const fileContent =
      await params.libraryAsset!.libraryManager.getFileContent(
        params.libraryAsset!.isPrivate,
        params.libraryAsset!.path,
        params.fileName,
      );

    params.dispatch!(
      addOrUpdateLibraryFile({
        assetPath: params.libraryAsset!.path,
        fileName: params.fileName,
        fileContent,
        isNew: params.isNew,
        isModified: false,
        isPrivate: params.libraryAsset!.isPrivate,
      }),
    );
    if (fileContent) {
      updateFileState({
        fileName: params.fileName,
        fileContent,
        setFileName: params.setFileName,
        setFileContent: params.setFileContent,
        setFileType: params.setFileType,
        setFilePrivacy: params.setFilePrivacy,
      });
    }
    params.setIsLibraryFile(true);
    params.setLibraryAssetPath(params.libraryAsset!.path);
  } catch {
    params.setFileContent(`Error fetching ${params.fileName} content`);
  }
};
