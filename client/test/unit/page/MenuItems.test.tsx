import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { lazy } from 'react';
import type { DtaasExtension } from '@into-cps-association/dtaas-sdk';
import MenuItems, { menuItemsFor } from 'page/MenuItems';

const menuEntries = [
  { name: 'Library', link: '/library' },
  { name: 'Digital Twins', link: '/digitaltwins' },
  { name: 'Automation', link: '/automation' },
  { name: 'Buildings', link: '/bim' },
  { name: 'Workbench', link: '/workbench' },
];

const renderMenu = (open: boolean, pathname = '/') =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <MenuItems open={open} />
    </MemoryRouter>,
  );

describe('MenuItems', () => {
  it('renders every menu item with its label and link', () => {
    renderMenu(true);

    menuEntries.forEach((entry) => {
      expect(screen.getByRole('link', { name: entry.name })).toHaveAttribute(
        'href',
        entry.link,
      );
    });
  });

  it('marks only the item matching the current route as the current page', () => {
    renderMenu(true, '/library');

    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('link', { name: 'Digital Twins' }),
    ).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Workbench' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  // The rail clips the labels, it does not remove them. What a screen reader
  // announces has to be the same in both states.
  it.each([true, false])('names every item with open %s', (open) => {
    renderMenu(open);

    menuEntries.forEach((entry) => {
      expect(
        screen.getByRole('link', { name: entry.name }),
      ).toBeInTheDocument();
    });
  });

  it('marks an extension entry active on the pages nested under it', () => {
    renderMenu(true, '/bim/models/Substation');

    expect(screen.getByRole('link', { name: 'Buildings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('offers a tooltip when the drawer is collapsed', async () => {
    renderMenu(false);

    await userEvent.hover(screen.getByRole('link', { name: 'Library' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Library');
  });
});

describe('menuItemsFor', () => {
  const page = lazy(() => Promise.resolve({ default: () => null }));
  const kit = (id: string, order?: number): DtaasExtension => ({
    id,
    name: id,
    version: '1.0.0',
    sdk: 1,
    routes: [{ path: '', element: page }],
    navigation: [{ label: id, path: `/${id}`, order }],
  });

  it('places extension entries among the core ones by their order', () => {
    const names = menuItemsFor([
      kit('late', 95),
      kit('early', 5),
      kit('mid'),
    ]).map(({ name }) => name);

    expect(names).toEqual([
      'early',
      'Library',
      'Digital Twins',
      'Automation',
      'mid',
      'Workbench',
      'late',
    ]);
  });

  it('gives an entry without an icon the default extension icon', () => {
    const [entry] = menuItemsFor([kit('early', 1)]);
    render(entry.icon);
    expect(screen.getByTestId('WidgetsRoundedIcon')).toBeInTheDocument();
  });
});
