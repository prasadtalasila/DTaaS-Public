import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import {
  LibraryIcon,
  DigitalTwinsIcon,
  AutomationIcon,
  WorkbenchIcon,
  DefaultExtensionIcon,
} from 'components/appIcons';
import { Link, useLocation } from 'react-router-dom';
import type { DtaasExtension } from '@into-cps-association/dtaas-sdk';
import extensionHost from 'extension/registry';

interface MenuItemEntry {
  order: number;
  name: string;
  icon: React.ReactElement;
  link: string;
}

/**
 * Core entries carry fixed orders with gaps, so an extension's `order` places
 * it between them: 20 falls between Automation and Workbench.
 */
const coreItems: MenuItemEntry[] = [
  { order: 10, name: 'Library', icon: <LibraryIcon />, link: '/library' },
  {
    order: 11,
    name: 'Digital Twins',
    icon: <DigitalTwinsIcon />,
    link: '/digitaltwins',
  },
  {
    order: 12,
    name: 'Automation',
    icon: <AutomationIcon />,
    link: '/automation',
  },
  {
    order: 90,
    name: 'Workbench',
    icon: <WorkbenchIcon />,
    link: '/workbench',
  },
];

/** Entries without an `order` go after the core ones and before Workbench. */
const DEFAULT_EXTENSION_ORDER = 50;

export function menuItemsFor(
  extensions: readonly DtaasExtension[],
): MenuItemEntry[] {
  const contributed = extensions.flatMap((ext) =>
    (ext.navigation ?? []).map(
      ({ label, path, icon: Icon = DefaultExtensionIcon, order }) => ({
        order: order ?? DEFAULT_EXTENSION_ORDER,
        name: label,
        icon: <Icon />,
        link: path,
      }),
    ),
  );
  // `sort` is stable, so equal orders keep core entries first.
  return [...coreItems, ...contributed].sort((a, b) => a.order - b.order);
}

const menuItems = menuItemsFor(extensionHost.enabled);

/** An extension's pages nest under its entry, so those count as active too. */
const isActive = (pathname: string, link: string) =>
  pathname === link || pathname.startsWith(`${link}/`);

/**
 * The navigation items of the drawer.
 *
 * The active item is decided from the router, not from `globalThis.location`,
 * so it is still correct when the application is served under a base path.
 *
 * When the drawer is collapsed to its rail the labels are clipped, so each
 * item carries a tooltip. The label stays in the document either way, which is
 * what a screen reader announces.
 */
function MenuItems({ open }: Readonly<{ open: boolean }>) {
  const { pathname } = useLocation();

  return (
    <>
      {menuItems.map((item) => {
        const selected = isActive(pathname, item.link);
        return (
          <Tooltip
            key={item.link}
            title={item.name}
            placement="right"
            disableHoverListener={open}
            disableFocusListener={open}
            disableTouchListener={open}
          >
            <ListItemButton
              component={Link}
              to={item.link}
              selected={selected}
              aria-current={selected ? 'page' : undefined}
              sx={{ mx: 1, my: 0.25, color: 'text.primary' }}
              data-logger-element="nav-link"
              data-logger-label={item.name}
              data-logger-context={JSON.stringify({
                nav: { link: item.link, active: selected },
              })}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.name}
                slotProps={{
                  primary: {
                    variant: 'body2',
                    noWrap: true,
                    sx: { fontWeight: selected ? 700 : 500 },
                  },
                }}
              />
            </ListItemButton>
          </Tooltip>
        );
      })}
    </>
  );
}

export default MenuItems;
