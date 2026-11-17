import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription, finalize } from 'rxjs';
import { Link, LinksService, apiErrorMessage, httpUrlValidator } from './links.service';

@Component({
  selector: 'app-root',
  imports: [ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  private readonly api = inject(LinksService);
  private readonly destroyRef = inject(DestroyRef);
  private listRequest?: Subscription;

  readonly form = new FormGroup({
    url: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, httpUrlValidator],
    }),
  });
  readonly links = signal<Link[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly result = signal<Link | null>(null);
  readonly fieldError = signal('');
  readonly submitError = signal('');
  readonly listError = signal('');

  ngOnInit(): void {
    this.loadLinks();
  }

  clearSubmitErrors(): void {
    this.fieldError.set('');
    this.submitError.set('');
  }

  submit(): void {
    if (this.submitting()) return;
    this.form.markAllAsTouched();
    this.clearSubmitErrors();
    if (this.form.invalid) return;

    this.submitting.set(true);
    this.result.set(null);
    this.api.create(this.form.controls.url.value.trim()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.submitting.set(false)),
    ).subscribe({
      next: (link) => {
        this.result.set(link);
        this.form.reset();
        this.loadLinks();
      },
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 400) {
          this.fieldError.set(apiErrorMessage(error));
        } else {
          this.submitError.set(apiErrorMessage(error));
        }
      },
    });
  }

  loadLinks(): void {
    this.listRequest?.unsubscribe();
    this.loading.set(true);
    this.listError.set('');
    this.listRequest = this.api.list().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false)),
    ).subscribe({
      next: (links) => this.links.set(links),
      error: (error: unknown) => this.listError.set(apiErrorMessage(error)),
    });
  }
}
