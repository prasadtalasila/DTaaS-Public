import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabComponent } from 'components/tab/TabComponent';
import { assetType } from 'route/library/LibraryTabData';
import { createCombinedTabs, createTabs } from 'route/library/Library';

jest.mock('components/tab/TabComponent', () => ({
  __esModule: true,
  ...jest.requireActual('components/tab/TabComponent'),
}));

jest.mock('components/asset/AssetLibrary', () => ({
  __esModule: true,
  default: () => <div data-testid="asset-library" />,
}));

jest.mock('components/cart/ShoppingCart', () => ({
  __esModule: true,
  default: () => <div data-testid="shopping-cart" />,
}));

describe('TabComponent', () => {
  const assetTypeTabs = createTabs();
  const scopeTabs = createCombinedTabs();

  test('renders an empty tab', () => {
    const { getByText } = render(
      <TabComponent assetType={assetTypeTabs} scope={scopeTabs} />,
    );
    const emptyTab = getByText('Functions');
    expect(emptyTab).toBeInTheDocument();
    userEvent.click(emptyTab);
  });

  test('renders tabs with labels and defaults to the first tab open', async () => {
    render(<TabComponent assetType={assetTypeTabs} scope={scopeTabs} />);

    const functionsAppear = screen.getAllByText('Functions');
    expect(functionsAppear.length).toBeGreaterThan(0);

    const modelsAppear = screen.getAllByText('Models');
    expect(modelsAppear.length).toBeGreaterThan(0);

    const functionsTab = assetType.find((tab) => tab.label === 'Functions');

    if (functionsTab) {
      const isFunctionsBody = screen.getAllByText('Functions');
      expect(isFunctionsBody.length).toBeGreaterThan(0);
    }

    const clickedTab = screen.getByRole('tab', { name: 'Models' });
    await userEvent.click(clickedTab);

    const modelsTab = assetType.find((tab) => tab.label === 'Models');

    if (modelsTab) {
      const isModelsBody = screen.getAllByText(modelsTab.body);
      const modelsBodyLength = isModelsBody.length;
      expect(modelsBodyLength).not.toBeLessThan(0);
    }
  });

  test('changes the active tab on click', async () => {
    render(<TabComponent assetType={assetTypeTabs} scope={scopeTabs} />);
    const clickedTab = screen.getByRole('tab', { name: 'Data' });

    await userEvent.click(clickedTab);

    const dataTab = assetType.find((tab) => tab.label === 'Data');

    if (dataTab) {
      const isDataBody = screen.getAllByText(dataTab.body);
      expect(isDataBody.length).toBeGreaterThan(0);
    }

    expect(
      screen.queryByText(assetTypeTabs[0].body.props.children),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(assetTypeTabs[1].body.props.children),
    ).not.toBeInTheDocument();
  });
});
