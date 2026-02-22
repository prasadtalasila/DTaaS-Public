import { useState, useEffect, Dispatch, SetStateAction } from 'react';
import Editor from '@monaco-editor/react';
import { useDispatch } from 'react-redux';
import { addOrUpdateLibraryFile } from 'model/store/libraryConfigFiles.slice';
import { addOrUpdateFile } from 'model/store/file.slice';

interface EditorTabProps {
  readonly tab: string;
  readonly fileName: string;
  readonly fileContent: string;
  readonly filePrivacy: string;
  readonly isLibraryFile: boolean;
  readonly libraryAssetPath: string;
  readonly setFileContent: Dispatch<SetStateAction<string>>;
}

interface FileUpdateParams {
  readonly tab: string;
  readonly fileName: string;
  readonly filePrivacy: string;
  readonly isLibraryFile: boolean;
  readonly libraryAssetPath: string;
}

export const handleEditorChange = (
  params: FileUpdateParams,
  value: string | undefined,
  setEditorValue: Dispatch<SetStateAction<string>>,
  setFileContent: Dispatch<SetStateAction<string>>,
  dispatch: ReturnType<typeof useDispatch>,
) => {
  const updatedValue = value || '';
  setEditorValue(updatedValue);
  setFileContent(updatedValue);

  const isPrivate = params.filePrivacy === 'private';

  if (params.tab === 'create') {
    if (!params.isLibraryFile) {
      dispatch(
        addOrUpdateFile({
          name: params.fileName,
          content: updatedValue,
          isNew: true,
          isModified: true,
        }),
      );
    } else {
      dispatch(
        addOrUpdateLibraryFile({
          assetPath: params.libraryAssetPath,
          fileName: params.fileName,
          fileContent: updatedValue,
          isNew: true,
          isModified: true,
          isPrivate,
        }),
      );
    }
  } else if (params.isLibraryFile || params.libraryAssetPath !== '') {
    dispatch(
      addOrUpdateLibraryFile({
        assetPath: params.libraryAssetPath,
        fileName: params.fileName,
        fileContent: updatedValue,
        isNew: false,
        isModified: true,
        isPrivate: true,
      }),
    );
  } else {
    dispatch(
      addOrUpdateFile({
        name: params.fileName,
        content: updatedValue,
        isNew: false,
        isModified: true,
      }),
    );
  }
};

function EditorTab({
  tab,
  fileName,
  fileContent,
  filePrivacy,
  isLibraryFile,
  libraryAssetPath,
  setFileContent,
}: EditorTabProps) {
  const [editorValue, setEditorValue] = useState(fileContent);
  const dispatch = useDispatch();

  useEffect(() => {
    setEditorValue(fileContent);
  }, [fileContent]);

  return (
    <div style={{ position: 'relative' }}>
      <Editor
        height="400px"
        defaultLanguage="markdown"
        value={editorValue}
        onChange={(value) =>
          handleEditorChange(
            {
              tab,
              fileName,
              filePrivacy,
              isLibraryFile,
              libraryAssetPath,
            },
            value,
            setEditorValue,
            setFileContent,
            dispatch,
          )
        }
        options={{
          readOnly: fileName === '',
        }}
      />
      {fileName === '' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.7)',
            color: 'black',
            zIndex: 1,
            fontSize: '16px',
            fontWeight: 'bold',
            pointerEvents: 'none',
          }}
        >
          Please select a file to edit.
        </div>
      )}
    </div>
  );
}

export default EditorTab;
