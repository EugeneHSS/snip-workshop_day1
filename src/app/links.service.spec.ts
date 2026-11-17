import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { LinksService, apiErrorMessage, httpUrlValidator } from './links.service';

describe('LinksService', () => {
  it('uses the same-origin shared API for listing and creation', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(LinksService);
    const http = TestBed.inject(HttpTestingController);
    api.list().subscribe();
    http.expectOne({ method: 'GET', url: '/api/links' }).flush([]);
    api.create('http://example.com').subscribe();
    const request = http.expectOne({ method: 'POST', url: '/api/links' });
    expect(request.request.body).toEqual({ url: 'http://example.com' });
    request.flush({});
    http.verify();
  });

  it('accepts both HTTP and HTTPS and delegates empty input to required validation', () => {
    for (const value of ['http://example.com', 'https://example.com/a?q=b', '']) {
      expect(httpUrlValidator(new FormControl(value))).toBeNull();
    }
  });

  it('safely formats unknown errors and non-string server error bodies', () => {
    for (const error of [null, new Error('internal'), new HttpErrorResponse({
      status: 500, error: { error: { private: 'details' } },
    })]) {
      expect(apiErrorMessage(error)).toBe('The request failed. Please try again.');
    }
  });
});
