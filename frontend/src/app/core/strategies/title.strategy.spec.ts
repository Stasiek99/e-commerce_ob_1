import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot } from '@angular/router';
import { AppTitleStrategy } from './title.strategy';

describe('AppTitleStrategy', () => {
  let strategy: AppTitleStrategy;
  let titleStub: { setTitle: jest.Mock; getTitle: jest.Mock };

  beforeEach(() => {
    titleStub = { setTitle: jest.fn(), getTitle: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        AppTitleStrategy,
        { provide: Title, useValue: titleStub },
      ],
    });

    strategy = TestBed.inject(AppTitleStrategy);
  });

  afterEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('sets the document title as "Route title | Aromaterie" when the route has a title', () => {
    jest.spyOn(strategy, 'buildTitle').mockReturnValue('Koszyk');

    strategy.updateTitle({ url: '/cart' } as RouterStateSnapshot);

    expect(titleStub.setTitle).toHaveBeenCalledWith('Koszyk | Aromaterie');
  });

  it('does NOT call Title.setTitle when the matched route has no title', () => {
    jest.spyOn(strategy, 'buildTitle').mockReturnValue(undefined);

    strategy.updateTitle({ url: '/no-title' } as RouterStateSnapshot);

    expect(titleStub.setTitle).not.toHaveBeenCalled();
  });

  it('appends the site name suffix consistently across all titles', () => {
    jest.spyOn(strategy, 'buildTitle').mockReturnValue('Regulamin');

    strategy.updateTitle({ url: '/legal/terms' } as RouterStateSnapshot);

    expect(titleStub.setTitle).toHaveBeenCalledWith(expect.stringContaining('| Aromaterie'));
  });
});
