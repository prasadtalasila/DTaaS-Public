import { screen, within } from '@testing-library/react';
import tabs from 'preview/route/digitaltwins/DigitalTwinTabDataPreview';
import userEvent from '@testing-library/user-event';
import {
  closestDiv,
  itShowsTheParagraphOfToTheSelectedTab,
  normalizer,
  setupIntegrationTest,
} from 'test/integration/integration.testUtil';
import { testLayout } from 'test/integration/Routes/routes.testUtil';

jest.mock('preview/components/asset/AssetBoard', () => ({
  __esModule: true,
  default: ({ tab }: { tab: string }) => (
    <iframe
      title={`JupyterLight-Demo-${tab}`}
      src="https://example.com/URL_DT"
    />
  ),
}));

jest.mock('preview/route/digitaltwins/create/CreatePage', () => ({
  __esModule: true,
  default: () => (
    <iframe title="JupyterLight-Demo-Create" src="https://example.com/URL_DT" />
  ),
}));

const setup = () => setupIntegrationTest('/digitaltwins');

describe('Digital Twins', () => {
  beforeEach(async () => {
    await setup();
  });

  it('renders the Digital Twins page and Layout correctly', async () => {
    await testLayout();

    const mainTablist = screen.getAllByRole('tablist')[0];

    const mainTabs = within(mainTablist).getAllByRole('tab');
    expect(mainTabs).toHaveLength(3);

    mainTabs.forEach((tab, tabIndex) => {
      expect(tab).toHaveTextContent(tabs[tabIndex].label);
    });

    const mainParagraph = screen.getByText(tabs[0].body, { normalizer });
    expect(mainParagraph).toBeInTheDocument();

    const mainParagraphDiv = closestDiv(mainParagraph);
    const iframe = within(mainParagraphDiv).getByTitle(
      /JupyterLight-Demo-Create/i,
    );
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveProperty('src', 'https://example.com/URL_DT');
  });

  it('shows the paragraph of to the selected tab', async () => {
    await itShowsTheParagraphOfToTheSelectedTab([
      tabs.filter((tab) => tab.label !== 'Analyze'),
    ]);
  });

  it('changes iframe src according to the selected tab', async () => {
    await tabs
      .filter((tab) => tab.label !== 'Analyze')
      .reduce(async (previousPromise, tabsData, tabsIndex) => {
        await previousPromise;
        const isFirstTab = tabsIndex === 0;
        const tab = screen.getByRole('tab', {
          name: tabsData.label,
          selected: isFirstTab,
        });
        await userEvent.click(tab);
        const iframe = screen.getByTitle(`JupyterLight-Demo-${tabsData.label}`);
        expect(iframe).toBeInTheDocument();
        expect(iframe).toHaveProperty('src', `https://example.com/URL_DT`);
      }, Promise.resolve());
  });
});
