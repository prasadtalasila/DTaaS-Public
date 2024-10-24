import DetailsButton from 'preview/components/asset/DetailsButton';
import { Provider } from 'react-redux';
import store from 'store/store';
import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as redux from 'react-redux';
import { Dispatch } from 'react';

jest.mock('react-redux', () => ({
  ...jest.requireActual('react-redux'),
  useSelector: jest.fn(),
}));

describe('DetailsButton', () => {
  const renderDetailsButton = (
    assetName: string,
    setShowDetails: Dispatch<React.SetStateAction<boolean>>,
  ) =>
    render(
      <Provider store={store}>
        <DetailsButton assetName={assetName} setShowDetails={setShowDetails} />
      </Provider>,
    );

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders the Details button', () => {
    renderDetailsButton('AssetName', jest.fn());
    expect(
      screen.getByRole('button', { name: /Details/i }),
    ).toBeInTheDocument();
  });

  it('handles button click and shows details', async () => {
    const mockSetShowDetails = jest.fn();

    (redux.useSelector as jest.Mock).mockReturnValue({
      getFullDescription: jest.fn().mockResolvedValue('Mocked description'),
    });

    renderDetailsButton('AssetName', mockSetShowDetails);

    const detailsButton = screen.getByRole('button', { name: /Details/i });
    fireEvent.click(detailsButton);

    await waitFor(() => {
      expect(mockSetShowDetails).toHaveBeenCalledWith(true);
    });
  });
});
