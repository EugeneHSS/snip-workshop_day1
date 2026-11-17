import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { Link } from './links.service';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let app: AppComponent;
  let http: HttpTestingController;
  const link: Link = {
    code: 'abc123',
    url: 'https://example.com/long',
    shortUrl: 'http://localhost:3000/abc123',
    hits: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const element = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    app = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('distinguishes loading from empty and renders an accessible form', () => {
    expect(element().textContent).toContain('Loading links...');
    expect(element().textContent).not.toContain('No links yet.');
    http.expectOne('/api/links').flush([]);
    fixture.detectChanges();
    expect(element().textContent).toContain('No links yet.');
    expect(element().querySelector('label')?.getAttribute('for')).toBe('url');
    expect(element().querySelector('input')?.getAttribute('aria-describedby')).toContain('url-error');
  });

  it('rejects empty, relative, malformed and non-http URLs without posting', () => {
    http.expectOne('/api/links').flush([]);
    for (const url of ['', ' ', '/relative', 'not a url', 'javascript:alert(1)', 'ftp://example.com']) {
      app.form.controls.url.setValue(url);
      app.submit();
      expect(app.form.invalid).withContext(url).toBeTrue();
    }
    fixture.detectChanges();
    expect(element().querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
    http.expectNone((request) => request.method === 'POST');
  });

  it('submits a trimmed URL once, shows the result and refreshes the table', () => {
    http.expectOne('/api/links').flush([]);
    app.form.controls.url.setValue(`  ${link.url}  `);
    element().querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    app.submit();
    fixture.detectChanges();
    expect(app.submitting()).toBeTrue();
    expect(element().querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBeTrue();
    const request = http.expectOne({ method: 'POST', url: '/api/links' });
    expect(request.request.body).toEqual({ url: link.url });
    request.flush(link, { status: 201, statusText: 'Created' });
    http.expectOne('/api/links').flush([link]);
    fixture.detectChanges();
    expect(app.submitting()).toBeFalse();
    expect(app.form.controls.url.value).toBe('');
    expect(element().querySelector('.success a')?.getAttribute('href')).toBe(link.shortUrl);
    expect(element().querySelector('tbody')?.textContent).toContain(link.url);
    expect(element().querySelector('tbody .hits')?.textContent?.trim()).toBe('0');
  });

  it('shows server validation beside the field and allows correction', () => {
    http.expectOne('/api/links').flush([]);
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne('/api/links').flush({ error: 'URL was rejected' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(element().querySelector('#url-error')?.textContent).toContain('URL was rejected');
    expect(app.submitting()).toBeFalse();
    expect(app.form.controls.url.value).toBe(link.url);
    element().querySelector('input')?.dispatchEvent(new Event('input'));
    expect(app.fieldError()).toBe('');
  });

  it('reports network errors without clearing input or claiming success', () => {
    http.expectOne('/api/links').flush([]);
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne('/api/links').error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(element().querySelector('[role=alert]')?.textContent).toContain('Cannot reach the server');
    expect(app.result()).toBeNull();
    expect(app.submitting()).toBeFalse();
    expect(app.form.controls.url.value).toBe(link.url);
  });

  it('does not present a failed initial list request as an empty list and can retry', () => {
    http.expectOne('/api/links').flush('down', { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(element().textContent).toContain('The request failed.');
    expect(element().textContent).not.toContain('No links yet.');
    app.loadLinks();
    http.expectOne('/api/links').flush([link]);
    expect(app.listError()).toBe('');
    expect(app.links()).toEqual([link]);
  });

  it('preserves rows with a warning on refresh failure and refreshes hit counts', () => {
    http.expectOne('/api/links').flush([link]);
    app.loadLinks();
    http.expectOne('/api/links').error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(element().textContent).toContain('Previously loaded links');
    expect(app.links()).toEqual([link]);
    app.loadLinks();
    http.expectOne('/api/links').flush([{ ...link, hits: 1 }]);
    fixture.detectChanges();
    expect(element().querySelector('tbody .hits')?.textContent?.trim()).toBe('1');
  });

  it('replaces an in-flight initial list when creation succeeds', () => {
    const initial = http.expectOne('/api/links');
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne('/api/links').flush(link, { status: 201, statusText: 'Created' });
    expect(initial.cancelled).toBeTrue();
    http.expectOne('/api/links').flush([link]);
    expect(app.links()).toEqual([link]);
    expect(app.loading()).toBeFalse();
  });
});
