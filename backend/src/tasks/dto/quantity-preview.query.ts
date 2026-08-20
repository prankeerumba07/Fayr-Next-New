import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * The count a reviewer is considering. Same bounds as the write path, so the
 * preview can never show a figure that confirming would then refuse — a preview
 * that disagrees with the action is worse than no preview.
 */
export class QuantityPreviewQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}
