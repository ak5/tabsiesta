import { mount } from 'svelte';
import App from './App.svelte';
import '../../assets/style.css';

mount(App, { target: document.getElementById('app')! });
