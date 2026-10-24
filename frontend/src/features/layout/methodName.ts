/** Короткое имя метода из MethodNode.id: «com.demo.service.OrderService.merge~0» → «OrderService.merge». */
export function shortMethodName(methodId: string): string {
  const withoutOverload = methodId.replace(/~\d+$/, '');
  const parts = withoutOverload.split('.');
  return parts.slice(-2).join('.');
}
