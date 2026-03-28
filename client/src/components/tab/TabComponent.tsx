import TabRender, { TabData } from 'components/tab/subcomponents/TabRender';
import {
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from 'components/tab/subcomponents/TabStyles';

function renderScopeTabList(
  scope: TabData[][],
  subIndex: number,
): React.ReactElement {
  return (
    <TabList>
      {scope &&
        scope[subIndex] &&
        scope[subIndex].map((tab, index) => <Tab key={index}>{tab.label}</Tab>)}
    </TabList>
  );
}

function renderScopeTabPanels(
  scope: TabData[][],
  subIndex: number,
): React.ReactElement {
  return (
    <>
      {scope &&
        scope[subIndex] &&
        scope[subIndex].map((tab, index) => (
          <TabPanel key={index}>
            <TabRender index={index}>{tab}</TabRender>
          </TabPanel>
        ))}
    </>
  );
}

export function TabComponent(props: {
  assetType: TabData[];
  scope: TabData[][];
}): React.ReactElement {
  return (
    <Tabs>
      <TabList>
        {props.assetType.map((tab, index) => (
          <Tab key={index}>{tab.label}</Tab>
        ))}
      </TabList>{' '}
      {props.assetType.map((subtab, subIndex) => (
        <TabPanel key={subIndex}>
          <TabRender index={subIndex}>{subtab}</TabRender>
          <Tabs>
            {renderScopeTabList(props.scope, subIndex)}
            {renderScopeTabPanels(props.scope, subIndex)}
          </Tabs>
        </TabPanel>
      ))}
    </Tabs>
  );
}

export default TabComponent;
