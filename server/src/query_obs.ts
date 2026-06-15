import OBSWebSocket from 'obs-websocket-js';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const obs = new OBSWebSocket();
  const url = process.env.OBS_WS_URL || 'ws://127.0.0.1:4455';
  const password = process.env.OBS_WS_PASSWORD;

  try {
    console.log(`Connecting to OBS at ${url}...`);
    await obs.connect(url, password);
    console.log('Connected!');

    console.log('\n--- SCENE LIST ---');
    const sceneList: any = await obs.call('GetSceneList');
    const activeScene = sceneList.currentProgramSceneName;
    console.log(`Current Program Scene: ${activeScene}`);

    console.log('\n--- VIDEO SETTINGS ---');
    const videoSettings = await obs.call('GetVideoSettings');
    console.log('Video Settings:', videoSettings);
    const baseWidth = videoSettings.baseWidth;
    const baseHeight = videoSettings.baseHeight;

    console.log('\n--- SCENE ITEM TRANSFORM ---');
    const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: activeScene });
    const mainItem = sceneItems.find((item: any) => item.sourceName === 'Overlay_Main');
    if (mainItem) {
      console.log('Centering Overlay_Main...');
      await obs.call('SetSceneItemTransform', {
        sceneName: activeScene,
        sceneItemId: mainItem.sceneItemId as number,
        sceneItemTransform: {
          alignment: 0, // Center
          positionX: baseWidth / 2,
          positionY: baseHeight / 2
        }
      });
      console.log('Centering done!');

      const transformResult: any = await obs.call('GetSceneItemTransform', {
        sceneName: activeScene,
        sceneItemId: mainItem.sceneItemId as number
      });
      console.log('New Transform of Overlay_Main:', transformResult.sceneItemTransform);
    } else {
      console.log('Overlay_Main not found in current scene to query/modify transform.');
    }

    await obs.disconnect();
  } catch (error: any) {
    console.error('Error connecting or querying OBS:', error.message || error);
  }
}

run();
