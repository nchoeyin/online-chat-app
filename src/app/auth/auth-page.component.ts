import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthCardComponent } from './auth-card.component';

@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports: [AuthCardComponent],
  template: `
    <div class="flex min-h-screen w-full items-center justify-center bg-neutral-50 px-4 py-12">
      <app-auth-card (authenticated)="onAuthenticated()" />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthPageComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected async onAuthenticated(): Promise<void> {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
    await this.router.navigateByUrl(returnUrl);
  }
}
