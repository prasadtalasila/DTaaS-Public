import { Dispatch, SetStateAction, Fragment } from 'react';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { useDispatch } from 'react-redux';
import {
  FileState,
  FileType,
  LibraryConfigFile,
} from 'model/backend/interfaces/sharedInterfaces';
import { getFilteredFileNames } from 'util/fileUtils';
import DigitalTwin from 'model/backend/digitalTwin';
import LibraryAsset from 'model/backend/libraryAsset';
import {
  renderFileTreeItems,
  renderFileSection,
} from 'route/digitaltwins/editor/sidebarRendering';

interface SidebarTreeContentProps {
  readonly name?: string;
  readonly digitalTwinInstance: DigitalTwin | null;
  readonly setFileName: Dispatch<SetStateAction<string>>;
  readonly setFileContent: Dispatch<SetStateAction<string>>;
  readonly setFileType: Dispatch<SetStateAction<string>>;
  readonly setFilePrivacy: Dispatch<SetStateAction<string>>;
  readonly setIsLibraryFile: Dispatch<SetStateAction<boolean>>;
  readonly setLibraryAssetPath: Dispatch<SetStateAction<string>>;
  readonly tab: string;
  readonly files: FileState[];
  readonly assets: LibraryAsset[];
  readonly libraryFiles: LibraryConfigFile[];
}

const SidebarTreeContent = ({
  name,
  digitalTwinInstance,
  setFileName,
  setFileContent,
  setFileType,
  setFilePrivacy,
  setIsLibraryFile,
  setLibraryAssetPath,
  tab,
  files,
  assets,
  libraryFiles,
}: SidebarTreeContentProps) => {
  const dispatch = useDispatch();

  const setters = {
    setFileName,
    setFileContent,
    setFileType,
    setFilePrivacy,
    setIsLibraryFile,
    setLibraryAssetPath,
  };

  return (
    <SimpleTreeView>
      {name && digitalTwinInstance ? (
        <Fragment key="reconfigure-page">
          {renderFileTreeItems(
            'Description',
            digitalTwinInstance.descriptionFiles,
            digitalTwinInstance,
            setters,
            files,
            tab,
            dispatch,
          )}
          {renderFileTreeItems(
            'Configuration',
            digitalTwinInstance.configFiles,
            digitalTwinInstance,
            setters,
            files,
            tab,
            dispatch,
          )}
          {renderFileTreeItems(
            'Lifecycle',
            digitalTwinInstance.lifecycleFiles,
            digitalTwinInstance,
            setters,
            files,
            tab,
            dispatch,
          )}
          {digitalTwinInstance.assetFiles.map(
            (assetFolder: { assetPath: string; fileNames: string[] }) =>
              renderFileTreeItems(
                `${assetFolder.assetPath} configuration`,
                assetFolder.fileNames,
                digitalTwinInstance,
                setters,
                files,
                tab,
                dispatch,
                true,
                libraryFiles,
                assetFolder.assetPath,
              ),
          )}
        </Fragment>
      ) : (
        <Fragment key="create-page">
          {renderFileSection(
            'Description',
            FileType.DESCRIPTION,
            getFilteredFileNames(FileType.DESCRIPTION, files),
            digitalTwinInstance,
            setters,
            files,
            tab,
            dispatch,
          )}
          {renderFileSection(
            'Configuration',
            FileType.CONFIGURATION,
            getFilteredFileNames(FileType.CONFIGURATION, files),
            digitalTwinInstance,
            setters,
            files,
            tab,
            dispatch,
          )}
          {renderFileSection(
            'Lifecycle',
            FileType.LIFECYCLE,
            getFilteredFileNames(FileType.LIFECYCLE, files),
            digitalTwinInstance,
            setters,
            files,
            tab,
            dispatch,
          )}
          {assets.map((asset) =>
            renderFileSection(
              asset.isPrivate
                ? `${asset.name} configuration`
                : `common/${asset.name} configuration`,
              FileType.CONFIGURATION,
              asset.configFiles,
              asset,
              setters,
              files,
              tab,
              dispatch,
              true,
              libraryFiles,
            ),
          )}
        </Fragment>
      )}
    </SimpleTreeView>
  );
};

export default SidebarTreeContent;
