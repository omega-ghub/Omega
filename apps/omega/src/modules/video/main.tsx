import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '../../styles.css';
import { ModuleApp } from './ModuleApp';

createRoot(document.getElementById('root')!).render(<ModuleApp />);
