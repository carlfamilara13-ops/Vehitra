import './src/features/rides/tracking/task'; // registers the background location task before the app mounts
import './src/features/reminders/movementTask'; // registers the opt-in idle movement task
import { registerRootComponent } from 'expo';
import App from './src/app/App';

registerRootComponent(App);

