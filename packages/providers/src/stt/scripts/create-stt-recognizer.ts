import { v2 } from '@google-cloud/speech';

const client = new v2.SpeechClient();

// Called one time before start of app
async function createRecognizer() {
  const projectId = process.env.GCP_PROJECT_ID!;
  const location = 'global';
  const recognizerId = 'frank-default-v2';

  const parent = `projects/${projectId}/locations/${location}`;

  const recognizer = {
    name: `${parent}/recognizers/${recognizerId}`,
    defaultRecognitionConfig: {
      languageCodes: ['en-GB', 'en-US'],
      model: 'latest_short', // good for commands
      features: {
        enableAutomaticPunctuation: true,
      },
      explicitDecodingConfig: {
        encoding: 'LINEAR16' as const,
        sampleRateHertz: 16000,
        audioChannelCount: 1,
      },
    },
  };

  const [operation] = await client.createRecognizer({
    parent,
    recognizer,
    recognizerId,
  });

  await operation.promise();
  console.log('Recognizer created:', recognizer.name);
}

createRecognizer().catch(console.error);
