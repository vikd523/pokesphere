/**
 * Auth Modal — Renders sign-in / sign-up modal UI.
 * Premium dark aesthetic with glassmorphism.
 * Defaults to signup mode since auth is required.
 */
import { signUp, signIn, type AuthUser } from './auth';

export type AuthMode = 'signin' | 'signup';

interface AuthModalState {
    mode: AuthMode;
    email: string;
    password: string;
    displayName: string;
    error: string | null;
    isLoading: boolean;
}

const modalState: AuthModalState = {
    mode: 'signup', // Default to signup since new users need accounts
    email: '',
    password: '',
    displayName: '',
    error: null,
    isLoading: false,
};

export function renderAuthModal(isVisible: boolean): string {
    if (!isVisible) return '';

    const isSignUp = modalState.mode === 'signup';

    return `
    <div class="auth-overlay" id="auth-overlay">
      <div class="auth-modal">
        <button class="auth-modal-close" id="auth-modal-close">×</button>
        <div class="auth-modal-header">
          <div class="auth-modal-logo">✦</div>
          <h2 class="auth-modal-title">${isSignUp ? 'Create Account' : 'Welcome Back'}</h2>
          <p class="auth-modal-subtitle">${isSignUp ? 'Join the Pokémon card community' : 'Sign in to access your collection'}</p>
        </div>

        <form class="auth-form" id="auth-form">
          ${isSignUp ? `
          <div class="auth-field">
            <label for="auth-name">Trainer Name</label>
            <input type="text" id="auth-name" placeholder="Enter your name"
                   value="${modalState.displayName}" autocomplete="name" required />
          </div>
          ` : ''}

          <div class="auth-field">
            <label for="auth-email">Email</label>
            <input type="email" id="auth-email" placeholder="you@example.com"
                   value="${modalState.email}" autocomplete="email" required />
          </div>

          <div class="auth-field">
            <label for="auth-password">Password</label>
            <input type="password" id="auth-password" placeholder="••••••••"
                   value="${modalState.password}" autocomplete="${isSignUp ? 'new-password' : 'current-password'}"
                   minlength="6" required />
          </div>

          ${modalState.error ? `<div class="auth-error">${modalState.error}</div>` : ''}

          <button type="submit" class="auth-submit" ${modalState.isLoading ? 'disabled' : ''}>
            ${modalState.isLoading ? 'Please wait...' : (isSignUp ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        <div class="auth-toggle">
          ${isSignUp
            ? `Already have an account? <button class="auth-toggle-btn" id="auth-toggle-btn">Sign In</button>`
            : `Don't have an account? <button class="auth-toggle-btn" id="auth-toggle-btn">Sign Up</button>`
        }
        </div>
      </div>
    </div>
  `;
}

export function bindAuthModalEvents(
    onSuccess: (user: AuthUser) => void,
    onRerender: () => void
): void {
    const form = document.getElementById('auth-form') as HTMLFormElement;
    const closeBtn = document.getElementById('auth-modal-close');
    const overlay = document.getElementById('auth-overlay');
    const toggleBtn = document.getElementById('auth-toggle-btn');

    closeBtn?.addEventListener('click', () => {
        resetModal();
        onRerender();
    });

    overlay?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            resetModal();
            onRerender();
        }
    });

    toggleBtn?.addEventListener('click', () => {
        modalState.mode = modalState.mode === 'signin' ? 'signup' : 'signin';
        modalState.error = null;
        onRerender();
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = (document.getElementById('auth-email') as HTMLInputElement)?.value.trim();
        const password = (document.getElementById('auth-password') as HTMLInputElement)?.value;
        const name = (document.getElementById('auth-name') as HTMLInputElement)?.value.trim();

        if (!email || !password) {
            modalState.error = 'Please fill in all fields';
            onRerender();
            return;
        }

        modalState.isLoading = true;
        modalState.error = null;
        modalState.email = email;
        modalState.password = password;
        modalState.displayName = name || '';
        onRerender();

        let result;
        if (modalState.mode === 'signup') {
            if (!name) {
                modalState.error = 'Please enter a trainer name';
                modalState.isLoading = false;
                onRerender();
                return;
            }
            result = await signUp(email, password, name);
        } else {
            result = await signIn(email, password);
        }

        modalState.isLoading = false;

        if (result.error) {
            modalState.error = result.error;
            onRerender();
        } else if (result.user) {
            resetModal();
            onSuccess(result.user);
        }
    });
}

function resetModal(): void {
    modalState.email = '';
    modalState.password = '';
    modalState.displayName = '';
    modalState.error = null;
    modalState.isLoading = false;
}

export function getModalMode(): AuthMode {
    return modalState.mode;
}

export function setModalMode(mode: AuthMode): void {
    modalState.mode = mode;
    modalState.error = null;
}
