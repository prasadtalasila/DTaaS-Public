import DigitalTwin from 'model/backend/digitalTwin';
import { ExecutionStatus } from 'model/backend/interfaces/execution';
import {
  setDigitalTwin,
  DigitalTwinData,
} from 'model/backend/state/digitalTwin.slice';
import { extractDataFromDigitalTwin } from 'model/backend/util/digitalTwinAdapter';
import { mockBackendInstance } from 'test/__mocks__/global_mocks';
import { Store } from 'test/integration/integration.testUtil';

export default function setupDigitalTwinBeforeEach(
  customStore: typeof Store,
): DigitalTwin {
  const digitalTwin = new DigitalTwin('mockedDTName', mockBackendInstance);
  (mockBackendInstance.getProjectId as jest.Mock).mockReturnValue(1234);

  const digitalTwinData: DigitalTwinData =
    extractDataFromDigitalTwin(digitalTwin);
  customStore.dispatch(
    setDigitalTwin({
      assetName: 'mockedDTName',
      digitalTwin: digitalTwinData,
    }),
  );

  digitalTwin.execute = jest.fn().mockImplementation(async () => {
    digitalTwin.lastExecutionStatus = ExecutionStatus.SUCCESS;
  });

  return digitalTwin;
}
