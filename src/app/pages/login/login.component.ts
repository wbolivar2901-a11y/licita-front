// src/app/auth/login/login.component.ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { switchMap, map } from 'rxjs';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  loading = false;
  errorMsg: string | null = null;

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    // scope es opcional: si quieres pedir un token reducido, agrega otro formControl y pásalo abajo
    // scope: ['licita.read licita.export']
  });

  submit(): void {
    this.errorMsg = null;
    if (this.form.invalid) return;

    this.loading = true;

    const { email, password } = this.form.value as { email: string; password: string };
    // Si usas scope opcional, por ejemplo:
    // const scope = this.form.value.scope?.trim();
    const scope = undefined;

    this.auth.login(email, password, scope)
      .pipe(
        // valida la respuesta del login antes de continuar
        map(res => {
          if (!res?.success) {
            throw new Error((res as any)?.message || 'Credenciales inválidas');
          }
          return res;
        }),
        // si el login fue OK, carga whoami
        switchMap(() => this.auth.loadWhoAmI())
      )
      .subscribe({
        next: () => {
          this.loading = false;
          this.router.navigateByUrl('/dashboard');
        },
        error: (err) => {
          this.loading = false;
          const be = err?.error; // payload del backend
          this.errorMsg =
            be?.message ||               // tu formato { message: '...' }
            be?.error?.message ||        // si viene { error: { message: '...' } }
            (typeof be === 'string' ? be : null) ||
            (err.status ? `${err.status} ${err.statusText}` : 'Error al iniciar sesión');
        },
      });
  }
}
