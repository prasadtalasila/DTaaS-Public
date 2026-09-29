/**
 * One icon per destination.
 *
 * The left menu and the workbench both link to the library and to the digital
 * twins, and each used to pick its own icon, so the same destination had two
 * faces. Naming them here keeps them from drifting apart.
 */

import ExtensionRoundedIcon from '@mui/icons-material/ExtensionRounded';
import PeopleRoundedIcon from '@mui/icons-material/PeopleRounded';
import PrecisionManufacturingRoundedIcon from '@mui/icons-material/PrecisionManufacturingRounded';
import HandymanRoundedIcon from '@mui/icons-material/HandymanRounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';

export const LibraryIcon = ExtensionRoundedIcon;
export const DigitalTwinsIcon = PeopleRoundedIcon;
export const AutomationIcon = PrecisionManufacturingRoundedIcon;
export const WorkbenchIcon = HandymanRoundedIcon;
/** For an extension whose menu entry names no icon of its own. */
export const DefaultExtensionIcon = WidgetsRoundedIcon;
