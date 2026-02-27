import { mockDigitalTwin, mockLibraryAsset } from 'test/__mocks__/global_mocks';
import * as SidebarFetchers from 'route/digitaltwins/editor/sidebarFetchers';
import * as FileUtils from 'util/fileUtils';

describe('sidebarFetchers', () => {
  const setFileName = jest.fn();
  const setFileContent = jest.fn();
  const setFileType = jest.fn();
  const setFilePrivacy = jest.fn();
  const setIsLibraryFile = jest.fn();
  const setLibraryAssetPath = jest.fn();
  const dispatch = jest.fn();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should fetch and set file content if library is true', async () => {
    const getLibraryFileContentSpy = jest
      .spyOn(mockDigitalTwin.DTAssets, 'getLibraryFileContent')
      .mockResolvedValue('fileContent');
    const updateFileStateSpy = jest.spyOn(FileUtils, 'updateFileState');

    await SidebarFetchers.fetchAndSetFileContent(
      {
        fileName: 'file1.md',
        digitalTwin: mockDigitalTwin,
        library: true,
        assetPath: 'assetPath',
      },
      {
        setFileName,
        setFileContent,
        setFileType,
        setFilePrivacy,
      },
    );

    expect(getLibraryFileContentSpy).toHaveBeenCalledTimes(1);
    expect(updateFileStateSpy).toHaveBeenCalledTimes(1);
  });

  it('should fetch and set file content if not library', async () => {
    const getFileContentSpy = jest
      .spyOn(mockDigitalTwin.DTAssets, 'getFileContent')
      .mockResolvedValue('fileContent');

    await SidebarFetchers.fetchAndSetFileContent(
      {
        fileName: 'file1.md',
        digitalTwin: mockDigitalTwin,
      },
      {
        setFileName,
        setFileContent,
        setFileType,
        setFilePrivacy,
      },
    );

    expect(getFileContentSpy).toHaveBeenCalledTimes(1);
  });

  it('should set error message if error occurs while fetching file content', async () => {
    jest
      .spyOn(mockDigitalTwin.DTAssets, 'getFileContent')
      .mockRejectedValue('error');

    await SidebarFetchers.fetchAndSetFileContent(
      {
        fileName: 'file1.md',
        digitalTwin: mockDigitalTwin,
      },
      {
        setFileName,
        setFileContent,
        setFileType,
        setFilePrivacy,
      },
    );

    expect(setFileContent).toHaveBeenCalledWith(
      'Error fetching file1.md content',
    );
  });

  it('should fetch and set file library content', async () => {
    const getFileContentSpy = jest
      .spyOn(mockLibraryAsset.libraryManager, 'getFileContent')
      .mockResolvedValue('fileContent');
    const updateFileStateSpy = jest.spyOn(FileUtils, 'updateFileState');

    await SidebarFetchers.fetchAndSetFileLibraryContent({
      fileName: 'file1.md',
      libraryAsset: mockLibraryAsset,
      setFileName,
      setFileContent,
      setFileType,
      setFilePrivacy,
      isNew: false,
      setIsLibraryFile,
      setLibraryAssetPath,
      dispatch,
    });

    expect(getFileContentSpy).toHaveBeenCalledTimes(1);
    expect(updateFileStateSpy).toHaveBeenCalledTimes(1);
    expect(setIsLibraryFile).toHaveBeenCalledWith(true);
    expect(setLibraryAssetPath).toHaveBeenCalledWith(mockLibraryAsset.path);
  });

  it('should set error message if error occurs while fetching file library content', async () => {
    jest
      .spyOn(mockLibraryAsset.libraryManager, 'getFileContent')
      .mockRejectedValue('error');

    await SidebarFetchers.fetchAndSetFileLibraryContent({
      fileName: 'file1.md',
      libraryAsset: mockLibraryAsset,
      setFileName,
      setFileContent,
      setFileType,
      setFilePrivacy,
      isNew: false,
      setIsLibraryFile,
      setLibraryAssetPath,
    });

    expect(setFileContent).toHaveBeenCalledWith(
      'Error fetching file1.md content',
    );
  });
});
