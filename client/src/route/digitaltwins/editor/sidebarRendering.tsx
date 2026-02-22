import { TreeItem, TreeItemProps } from '@mui/x-tree-view/TreeItem';
import {
  LibraryConfigFile,
  FileState,
} from 'model/backend/interfaces/sharedInterfaces';
import DigitalTwin from 'model/backend/digitalTwin';
import LibraryAsset from 'model/backend/libraryAsset';
import { Dispatch, SetStateAction } from 'react';
import { useDispatch } from 'react-redux';
import {
  handleFileClick,
  AssetOrNull,
} from 'route/digitaltwins/editor/sidebarFunctions';

interface FileStateSetters {
  readonly setFileName: Dispatch<SetStateAction<string>>;
  readonly setFileContent: Dispatch<SetStateAction<string>>;
  readonly setFileType: Dispatch<SetStateAction<string>>;
  readonly setFilePrivacy: Dispatch<SetStateAction<string>>;
  readonly setIsLibraryFile: Dispatch<SetStateAction<boolean>>;
  readonly setLibraryAssetPath: Dispatch<SetStateAction<string>>;
}

export const renderFileTreeItems = (
  label: string,
  filesToRender: string[],
  asset: DigitalTwin | LibraryAsset,
  setters: FileStateSetters,
  files: FileState[],
  tab: string,
  dispatch: ReturnType<typeof useDispatch>,
  library?: boolean,
  libraryFiles?: LibraryConfigFile[],
  assetPath?: string,
) => {
  const baseLabel =
    asset instanceof LibraryAsset && !asset.isPrivate
      ? `common/${label.toLowerCase()}`
      : label.toLowerCase();

  return (
    <TreeItem
      key={`${baseLabel}-${label}`}
      itemId={`${baseLabel}-${label}`}
      label={label as TreeItemProps['label']}
    >
      {filesToRender.map((item, index) => {
        const itemLabel =
          asset instanceof LibraryAsset && !asset.isPrivate
            ? `common/${item}`
            : item;

        return (
          <TreeItem
            key={`${baseLabel}-${item}-${index}`}
            itemId={`${baseLabel}-${item}`}
            label={itemLabel}
            onClick={() =>
              handleFileClick(item, asset, setters, files, tab, {
                dispatch,
                library,
                libraryFiles,
                assetPath,
              })
            }
          />
        );
      })}
    </TreeItem>
  );
};

export const renderFileSection = (
  label: string,
  type: string,
  filesToRender: string[],
  asset: AssetOrNull,
  setters: FileStateSetters,
  files: FileState[],
  tab: string,
  dispatch: ReturnType<typeof useDispatch>,
  library?: boolean,
  fileLibrary?: LibraryConfigFile[],
) => {
  const baseLabel =
    asset instanceof LibraryAsset && !asset.isPrivate
      ? `common/${label.toLowerCase()}`
      : label.toLowerCase();

  return (
    <TreeItem
      key={`${baseLabel}-${label}`}
      itemId={`${baseLabel}-${label}`}
      label={label}
    >
      {filesToRender.map((item, index) => (
        <TreeItem
          key={`${baseLabel}-${item}-${index}`}
          itemId={`${baseLabel}-${item}`}
          label={item}
          onClick={() => {
            if (!asset) {
              // Handle the case where there's no asset
              return;
            }
            handleFileClick(item, asset, setters, files, tab, {
              dispatch,
              library,
              libraryFiles: fileLibrary,
            });
          }}
        />
      ))}
    </TreeItem>
  );
};
